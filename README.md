# SVG Studio

A TypeScript, Next.js, and Tailwind app for converting static or SMIL-animated SVGs into transparent GIFs.

## Development

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Choose an SVG or try the sample, adjust the export settings, and download the GIF. The default output width is 480px for faster conversions.

## Docker deployment

```sh
cp .env.example .env
docker compose up --build -d
```

For a public deployment, set `APP_ORIGIN` in `.env` to the exact public URL, such as `https://converter.example.com`. Put an HTTPS reverse proxy in front of port 3000. `PORT` changes the published host port.

The container runs as a non-root user and includes a health check at `/api/health`. Run one replica: jobs and sessions are held in process memory, and output files use temporary local storage. Restarting the server clears sessions and results. Serverless functions and multiple replicas require an external job queue and shared storage.

## Node deployment

```sh
npm ci
npm run build
APP_ORIGIN=https://converter.example.com npm start
```

The server listens on `0.0.0.0:3000`, or the port in `PORT`. Production requires `APP_ORIGIN`. The build compiles the conversion worker to `dist/`; deploy that folder together with `.next`, `public`, `package.json`, `package-lock.json`, and `next.config.ts`. Install production dependencies with `npm ci --omit=dev`.

## Quality checks

```sh
npm run check
npm run build
npm run test:build
```

`check` runs strict TypeScript checking, formatting validation, and regression tests. The production smoke test exercises the compiled Next.js API, HTTPS session validation, the compiled worker, GIF downloads, and transparent pixels.

```sh
npm run format
```

## CLI

```sh
npm run convert -- public/sample.svg -o animation.gif --width 480 --fps 20
npm run convert -- --help
```

CLI commands require development dependencies. Existing outputs are preserved unless `--force` is supplied.

## Conversion behavior

- Supports static shapes, gradients, masks, clipping, embedded PNG/JPEG/WebP images, and SMIL `animate`, `animateTransform`, and `set`.
- Supports linear, discrete, and spline interpolation, repeated animation, and freeze behavior.
- Rejects scripts, external assets, CSS animation, event-based timing, motion paths, and unsupported animation combinations.
- Uses a shared color palette and clears previous frames to prevent trails.
- Preserves opaque black artwork separately from transparent pixels.
- GIF supports binary transparency. Pixels with alpha below 128 become transparent; remaining pixels become opaque. Explicit background shapes in the SVG are preserved.

SVG uploads are limited to 10 MB. Export limits are 4096px per dimension, 50 fps, 120 seconds, 1800 frames, and 800 million total pixels. A conversion may run for up to 10 minutes. One export runs at a time, and the last 10 results are retained for up to 30 minutes. Browser sessions expire after inactivity. Each session can access only its own exports.

## Source layout

| Path          | Responsibility                                                  |
| ------------- | --------------------------------------------------------------- |
| `pages/`      | Next.js pages and API entry point                               |
| `components/` | Preview, settings, and reusable form controls                   |
| `hooks/`      | Upload, conversion, polling, and UI state                       |
| `lib/server/` | Deployment configuration, sessions, and job lifecycle           |
| `lib/`        | SVG validation, animation sampling, rendering, and GIF encoding |
| `scripts/`    | CLI and verification tools                                      |
| `styles/`     | Tailwind theme and shared styles                                |
| `public/`     | Sample SVG                                                      |
