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
| **0** | 0 MB  | never                          | Capture and shader transformation — no ML at all |
| **1** | 11 MB | in the background after photo 1 | Recognition, similarity, personalised training   |
| **2** | 18 MB | before the first video          | Real depth map and 2.5D parallax                 |
| **3** | 41 MB | the first time you type a description | Understanding of free-form text            |

The vocabulary of image archetypes ("face", "bird", "tree", "cloud") is encoded **at build
time** into a single ~0.5 MB file, so recognition works without the text model.

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
