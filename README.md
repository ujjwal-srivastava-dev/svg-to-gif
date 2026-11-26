# SVG Studio

A TypeScript, Next.js, and Tailwind app for converting static or SMIL-animated SVGs into transparent GIFs.

## Development

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Choose an SVG or try the sample, adjust the export settings, and download the GIF. The default output width is 480px for faster conversions.

## Vercel deployment

Import the repository as a Next.js project. Use Node.js 22 or newer, the build command `npm run build`, and the default Next.js output directory. Enable Fluid Compute. Set `APP_ORIGIN` to your public URL (for example `https://svg-to-gif.vercel.app`), without a trailing path. You do not need to set `PORT`. Redeploy after changing environment variables. When `APP_ORIGIN` is absent, the app uses Vercel's deployment URL; the deployment URL also works for previews.

The build compiles the worker and explicitly includes every `dist` module and its runtime dependencies in the API function trace. This prevents missing `dist/converter.js` and native Sharp imports in the deployed function.

On Vercel, conversion runs inside an awaited streaming request. Progress and GIF chunks return to the same browser request, and the browser creates the preview/download locally. No job polling, sticky sessions, shared disk, or storage credentials are required. Closing the request cancels its worker; temporary files are removed when the request finishes. The GIF stays available in the current page until replaced or the page closes.

Vercel mode limits the complete JSON upload to 4 MiB, including JSON escaping, and conversion to 270 seconds within a 300-second function duration. Larger or slower exports need a smaller size, shorter duration, lower frame rate, or the Node/Docker deployment below. These limits accommodate the default [Vercel function limits](https://vercel.com/docs/functions/limitations). One conversion runs per instance at a time; this public converter does not implement an account system or a distributed rate limit.

## Export sizes and preview

Choose quick export, 480p, 720p HD, 1080p Full HD, 1440p QHD, 2160p 4K, original size, or custom dimensions. With aspect ratio locked, artwork fits inside the preset: 16:9 artwork exports at 1920 × 1080 for Full HD; square artwork exports at 1080 × 1080. Unlock aspect ratio to use the full preset canvas. The actual dimensions are always displayed before export.

The SVG preview updates immediately to the selected dimensions and background; Restart replays the source animation. Transparent uses a light checkerboard. White, black, dark blue, and custom colors appear directly on the preview canvas. Changing the background clears the previous GIF and returns to the live SVG preview; convert again to download the updated GIF. This preview uses browser SVG playback. Select Exported GIF after conversion to check the actual GIF timing, palette, dithering, and transparency.

Preview and export both clear the SVG root's CSS background and hide plain, leading canvas-sized rectangles or rectangular paths, so an embedded black or white background does not cover the selected background. Foreground colors, including black artwork, are preserved. Transformed shapes, animated shapes, outlines, definitions, and embedded raster images are not treated as plain canvas backgrounds. Backgrounds drawn as complex artwork require editing the source SVG.

## Docker deployment

```sh
cp .env.example .env
docker compose up --build -d
```

For a public deployment, set `APP_ORIGIN` in `.env` to the exact public URL, such as `https://converter.example.com`. Put an HTTPS reverse proxy in front of port 3000. `PORT` changes the published host port.

The container runs as a non-root user and includes a health check at `/api/health`. Run one replica: jobs and sessions are held in process memory, and output files use temporary local storage. Restarting the server clears sessions and results. This job/polling mode is separate from Vercel's request-scoped streaming mode.

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

`check` runs strict TypeScript checking, formatting validation, and regression tests. The production smoke test exercises the compiled Next.js API, HTTPS session validation, the compiled worker, GIF downloads, and transparent pixels. It then copies only files listed in the deployment trace to an isolated folder and verifies a streamed, animated 1080p export with native Sharp dependencies.

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
- GIF supports binary transparency. Pixels with alpha below 128 become transparent; remaining pixels become opaque. Plain SVG canvas backgrounds are replaced by the selected export background.

SVG uploads are limited to 10 MB on Node/Docker and a 4 MiB JSON request on Vercel. Export limits are 4096px per dimension, 50 fps, 120 seconds, 1800 frames, and 800 million total pixels. These workload limits also apply to HD and 4K presets. In Node/Docker mode, a conversion may run for up to 10 minutes; one export runs at a time, and the last 10 results are retained for up to 30 minutes. Browser sessions expire after inactivity. Each session can access only its own exports. Vercel mode uses the streaming lifecycle described above.

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
