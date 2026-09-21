# Vision

Capture the image you see in a thing — a face in a wall, an animal in a cloud — and let the
browser sharpen it into something you can actually show someone, then bring it to life as a
short video.

Everything runs **on your device**. There is no server, no account, and no upload. Photos,
videos, descriptions and the weights of the model that learns your taste never leave the
browser's storage.

## How it works

The app is built around one idea: **the neural network does not draw the picture — it drives
the renderer.**

1. A CLIP model encodes your photo (and your description, if you write one) into vectors.
2. A small neural network — trained locally, on your own photos — turns those vectors into
   about twenty rendering parameters: edge strength, line coherence, contrast, palette,
   parallax amplitude, motion speed, and so on.
3. WebGL2 shaders use those parameters to render the transformed image and every frame of
   the video.
4. When you nudge a slider or rate a result, that becomes a training example and the network
   learns from it immediately.

## Progressive model loading

Nothing is downloaded speculatively. The app is useful before a single byte of model weight
arrives.

| Tier  | Size  | Downloaded when                | Unlocks                                         |
| ----- | ----- | ------------------------------ | ----------------------------------------------- |
| **0** | 0 MB  | never                          | Capture, shader transformation and the clip — no ML at all |
| **1** | 11 MB | in the background after photo 1 | Recognition, similarity, personalised training   |
| **2** | 18 MB | before the first video          | Real depth map and 2.5D parallax                 |
| **3** | 41 MB | the first time you type a description | Understanding of free-form text            |

Whichever tier arrives first also brings the ONNX runtime, about 7 MB
compressed. That is stated separately in the settings screen rather than folded
into a model's size, because a progress bar claiming eleven megabytes and then
spending most of its time elsewhere would be a lie.

The vocabulary of image archetypes — face, bird, tree, cloud — is encoded into
one small file at build time, so recognition works without the text model:

```bash
npm run build:vocabulary    # needs network access to Hugging Face
```

If that step never runs the app still works: it encodes the vocabulary on the
device the first time the text tier is present, and caches the result. The
build step exists to avoid needing that tier at all, not because anything
depends on it.

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

`localhost` counts as a secure context, so the camera works there without any certificate.

### Opening it on a phone

The camera, service worker and PWA install all require HTTPS, and `http://192.168.x.x` does
not qualify. Two options:

```bash
npm run dev:https    # locally trusted certificate via mkcert
```

On iOS you must install **and** trust the generated root certificate — two separate steps
that are easy to conflate:

1. Settings → General → VPN & Device Management → install the profile.
2. Settings → General → About → Certificate Trust Settings → enable full trust for it.

If that is fiddly, a tunnel (Cloudflare Tunnel, ngrok) gives you a real public HTTPS origin
and tends to be less painful — and it exercises the genuine install flow.

### Other commands

```bash
npm run build         # typecheck, then production build
npm run typecheck
npm run lint          # oxlint, warnings are errors
npm run format        # prettier
npm test              # vitest
npm run generate:assets   # regenerate PWA icons from public/logo.svg
```

### Verifying the parts Node cannot run

The shader chain needs WebGL and the video export needs WebCodecs, neither of
which exists under Node, so those are checked by driving a real browser. They
need `npm run dev` running in another terminal.

```bash
npm run verify:render    # renders a synthetic image, measures the contour pass
npm run verify:video     # encodes a real ten-second clip and plays it back
npm run diagnose:render  # per-pass statistics, for when a signal goes missing
```

`verify:render` works by difference: it renders the same image with the contour
overlay off and then on, so what it measures is the edge pass and nothing else.
That is what caught the shader bug described in the commit history — absolute
brightness would have looked fine.

These use the system Edge rather than a downloaded Chromium, because this
machine's TLS interception blocks Playwright's browser download. Run
`npm run playwright:install` if you would rather use a real Chromium and your
network allows it.

## Environment notes

These are real constraints of this machine's toolchain, discovered while setting the project
up. They are written down so they do not have to be rediscovered.

- **`npx` is blocked.** The NVM installation wraps package-manager execution and refuses
  delegated scripts (`NVM4306`). Use `npm run <script>` instead.
- **`legacy-peer-deps=true` is set in `.npmrc`.** npm 10.8.2, which ships with Node 20,
  crashes with `Cannot read properties of null (reading 'edgesOut')` while resolving
  vitest's optional peer set. Every other package resolves cleanly without the flag, so this
  works around an npm bug rather than papering over a real conflict. `npm ci` reproduces the
  tree exactly.
- **Node 20.20.2 is the active runtime**, which is the oldest version this stack supports:
  - Vite 8 requires `^20.19.0 || >=22.12.0` — satisfied.
  - Vitest is pinned to **4.1.11**, the newest line that still supports Node 20. Vitest 5
    requires Node 22+.
  - `vite-plugin-mkcert` pulls in `undici@8`, which refuses to load on Node 20. It is
    therefore imported **lazily**, only in `dev:https` mode, so that `dev`, `build` and
    `test` stay usable. Running `dev:https` itself needs Node 22+.
  - Moving to Node 22 LTS would remove the last two caveats.
- **`@vite-pwa/assets-generator` is pinned to 1.x**, because `vite-plugin-pwa@1.3.0` declares
  a peer range of `^1.0.0` and rejects 2.x.
- **TypeScript 7 removed `baseUrl`.** Path aliases in `tsconfig.app.json` are resolved
  relative to the config file instead.
- **This network intercepts TLS.** Anything that downloads at build time fails with
  `SELF_SIGNED_CERT_IN_CHAIN` — Playwright's browser download and `npm run build:vocabulary`
  both do. The browser verification scripts therefore drive the system Edge, and the
  vocabulary falls back to being encoded on device.

## What has and has not been verified

The shader chain and the video export are checked in a real browser by the
scripts above, and the trainable head's gradients are checked against finite
differences.

The model tiers are **not** verified end to end: the weights cannot be
downloaded from this machine, so recognition, depth and text understanding have
been written against the documented APIs but never actually executed. They are
the first thing to exercise on a network that allows the download.

## Layout

```
src/
  app/        routes and the responsive shell
  core/       storage, database, i18n, job queue, shared helpers
  ml/         model registry, embeddings, depth, and the trainable head
  render/     WebGL2 core, shaders, transformation, animation, video export
  features/   feature-level UI
tools/        build-time scripts (vocabulary encoding)
```

## Publishing

Deployment is deliberately the last step and is not needed for development. When the time
comes, a GitHub Actions workflow builds the site and publishes it to GitHub Pages; the
repository must be public for Pages on the free plan.
