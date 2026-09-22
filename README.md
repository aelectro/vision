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

The camera, service worker and PWA install all require HTTPS, and
`http://192.168.x.x` does not qualify.

```bash
npm run dev:https    # self-signed certificate, reachable over the LAN
```

Safari will warn about the certificate, and it treats an untrusted one as a
reason to refuse service worker registration — so for testing the *installed*
PWA, a tunnel (Cloudflare Tunnel, ngrok) is the reliable route. It gives a real
public HTTPS origin and exercises the genuine install flow.

`vite-plugin-mkcert` would issue a locally trusted certificate instead, but it
depends on undici, which will not load on Node 20, and a config-time dynamic
import cannot be guarded because the config bundler hoists it. On Node 22 it is
worth adding back.

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
npm run verify:render       # renders a synthetic image, measures the contour pass
npm run verify:orientation  # checks the image comes out the right way up
npm run verify:video        # encodes a real ten-second clip and plays it back
npm run verify:diagnostics  # runs the in-app device checks
npm run diagnose:render     # per-pass statistics, for when a signal goes missing
```

`verify:render` works by difference: it renders the same image with the contour
overlay off and then on, so what it measures is the edge pass and nothing else.
That is what caught the shader bug described in the commit history — absolute
brightness would have looked fine.

`verify:orientation` exists because `verify:render` could not do its job: it
draws a centred circle, which looks identical upside down. A vertical flip
survived that check and only surfaced on a real photo. Its target is
asymmetric in both axes, so a flip or a mirror shows up as a marker landing in
the wrong corner — and it names which.

```bash
npm run benchmark        # timings for the shader chain, video export and training
```

Measured on this desktop, September 2026:

| What | Cost |
| --- | --- |
| Shader chain, 6 passes | 1.1 ms at 1024×768, 2.8 ms at 2048×1536, 4.1 ms at 2560×1920 |
| Video export | 5.0 ms per frame, 1.5 s for the whole clip, 1.6 MB |
| Forward + backward | 0.46 ms per example, 298k parameters |
| Adam step | 0.73 ms — more than a forward and backward pass together |
| One piece of feedback | 321 ms, 40 steps over 16 examples |

A phone is roughly three to five times slower. That last row is why training
yields to the browser between steps: run straight through it would be about a
second during which nothing scrolls.

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
  - `vite-plugin-mkcert` depends on `undici@8`, which refuses to load on Node 20, so
    `dev:https` uses `@vitejs/plugin-basic-ssl` instead. A config-time dynamic import
    cannot be guarded against this, because the config bundler hoists it into a static
    one before any `try` runs.
  - Moving to Node 22 LTS would remove both caveats.
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

Deployment is not needed for development, but it is the easiest way to get the
app onto a phone — the camera needs HTTPS, and a real origin also lets you
install it to the home screen properly.

`.github/workflows/deploy.yml` lints, tests, builds and publishes to GitHub
Pages on every push to `main`. What you have to do once:

1. Create a **public** repository and push. Pages from a private repository
   needs a paid plan.
2. Settings → Pages → Source: **GitHub Actions**.

The workflow passes `VITE_BASE=/<repo>/` so the bundle knows it is served from
a subdirectory. Everything else is already relative: routing is hash-based, so
there are no deep links for the server to rewrite, and the manifest's
`start_url`, `scope` and icons resolve against their own location.

Your photos, videos, descriptions and the weights of the model that learns your
taste never leave the browser. Only source code goes to the repository; model
weights are fetched from Hugging Face by the browser and cached locally.
