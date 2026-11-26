import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Document } from '../lib/animation.ts';
import { createApi } from '../lib/api.ts';
import { convert } from '../lib/converter.ts';
import { Cancelled, settings } from '../lib/document.ts';
import { gifFrame, gifHeader } from '../lib/gif.ts';
import { presetDimensions } from '../lib/presets.ts';
import { streamGif } from '../lib/client.ts';
import { clearSvgBackground } from '../lib/svg-background.ts';
import type { ExportEvent, JobSnapshot } from '../lib/types.ts';
import { httpClient } from './http-client.ts';

const svg = (content: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40">${content}</svg>`;
const moving = svg(
  '<rect x="0" y="10" width="10" height="10" fill="red"><animate attributeName="x" values="0;60" dur="1s" repeatCount="indefinite"/></rect>',
);

test('SVG preview and GIF export replace embedded backgrounds while preserving black artwork', async (context) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'svg-background-'));
  context.after(() => rm(folder, { recursive: true, force: true }));
  const backgrounds = [
    '',
    '<rect width="100%" height="100%" fill="black"/>',
    '<g><rect width="80" height="40" fill="white"/></g>',
    '<path d="M0 0h80v40H0z" fill="black"/>',
  ];

  for (const [index, layer] of backgrounds.entries()) {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40" style="background:#000!important"><style>svg{background-color:black!important}</style>${layer}<circle cx="40" cy="20" r="10" fill="black"/><circle cx="65" cy="20" r="5" fill="red"/></svg>`;
    const document = new DOMParser().parseFromString(source, 'image/svg+xml');
    clearSvgBackground(document.documentElement!);
    const preview = new XMLSerializer().serializeToString(document);
    assert.match(
      document.documentElement!.getAttribute('style')!,
      /background-color:transparent!important$/,
    );

    for (const background of ['transparent', '#ffffff', '#000000', '#00ff00']) {
      const output = path.join(folder, `${index}-${background}.gif`);
      await convert(source, output, { background });
      const gifPixels = await sharp(output).ensureAlpha().raw().toBuffer();
      let render = sharp(Buffer.from(preview)).ensureAlpha();
      if (background !== 'transparent')
        render = render.flatten({ background }).ensureAlpha();
      const previewPixels = await render.raw().toBuffer();
      const expected =
        background === 'transparent'
          ? [0, 0, 0, 0]
          : [...Buffer.from(background.slice(1), 'hex'), 255];
      assert.deepEqual(Array.from(gifPixels.subarray(0, 4)), expected);
      assert.deepEqual(Array.from(previewPixels.subarray(0, 4)), expected);
      for (const pixels of [gifPixels, previewPixels]) {
        assert.deepEqual(
          Array.from(pixels.subarray((20 * 80 + 40) * 4, (20 * 80 + 40) * 4 + 4)),
          [0, 0, 0, 255],
        );
        assert.deepEqual(
          Array.from(pixels.subarray((20 * 80 + 65) * 4, (20 * 80 + 65) * 4 + 4)),
          [255, 0, 0, 255],
        );
      }
    }
  }
});

test('background removal preserves definitions, outlines, transformed and animated artwork', () => {
  for (const layer of [
    '<rect width="80" height="40" fill="none" stroke="black"/>',
    '<rect width="80" height="40" fill="black" transform="rotate(30)"/>',
    '<rect width="80" height="40" fill="black"><animate attributeName="x" values="0;20" dur="1s"/></rect>',
    '<path d="M0 0 L80 40 L80 0 L0 40Z" fill="black"/>',
    '<g transform="scale(0.5)"><rect width="80" height="40" fill="black"/></g>',
    '<rect id="paint" width="80" height="40" fill="black"/><use href="#paint"/>',
  ]) {
    const document = new DOMParser().parseFromString(svg(layer), 'image/svg+xml');
    clearSvgBackground(document.documentElement!);
    assert.doesNotMatch(new XMLSerializer().serializeToString(document), /display:none/);
  }
  const document = new DOMParser().parseFromString(
    svg(
      '<defs><clipPath id="clip"><rect width="80" height="40"/></clipPath></defs><rect width="80" height="40" fill="black"/><circle cx="40" cy="20" r="5" fill="red" clip-path="url(#clip)"/>',
    ),
    'image/svg+xml',
  );
  clearSvgBackground(document.documentElement!);
  const rectangles = document.getElementsByTagName('rect');
  assert.doesNotMatch(rectangles[0].getAttribute('style') || '', /display:none/);
  assert.match(rectangles[1].getAttribute('style') || '', /display:none/);
});

test('animated exports keep transparent backgrounds after removing a canvas layer', async (context) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'svg-background-'));
  context.after(() => rm(folder, { recursive: true, force: true }));
  const source = moving.replace(
    '<rect x=',
    '<rect width="80" height="40" fill="black"/><rect x=',
  );
  const output = path.join(folder, 'moving.gif');
  await convert(source, output, { fps: 2 });
  const pixels = await sharp(output, { animated: true }).ensureAlpha().raw().toBuffer();
  assert.equal(pixels[3], 0);
  assert.equal(pixels[80 * 40 * 4 + 3], 0);
  assert.equal(pixels[(15 * 80 + 5) * 4 + 3], 255);
  assert.equal(pixels[(40 * 80 + 15 * 80 + 5) * 4 + 3], 0);
});

function streamEvents(body: Buffer): ExportEvent[] {
  return body
    .toString()
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as ExportEvent);
}

test('HD presets preserve artwork aspect ratios and support full video dimensions', () => {
  const landscape = { width: 160, height: 90, animations: 1, duration: 1 };
  assert.deepEqual(presetDimensions('720p', landscape, true), {
    width: 1280,
    height: 720,
  });
  assert.deepEqual(presetDimensions('1080p', landscape, true), {
    width: 1920,
    height: 1080,
  });
  assert.deepEqual(presetDimensions('2160p', landscape, true), {
    width: 3840,
    height: 2160,
  });
  assert.deepEqual(presetDimensions('1080p', { ...landscape, width: 90 }, true), {
    width: 1080,
    height: 1080,
  });
  assert.deepEqual(
    presetDimensions('720p', { ...landscape, width: 90, height: 160 }, true),
    { width: 405, height: 720 },
  );
  assert.deepEqual(presetDimensions('1080p', { ...landscape, width: 90 }, false), {
    width: 1920,
    height: 1080,
  });
});

test('serverless exports stream across fresh instances and produce transparent HD GIFs', async (context) => {
  const first = await createApi({ streaming: true });
  const second = await createApi({ streaming: true });
  context.after(async () => {
    await first.close();
    await second.close();
  });
  let service = first;
  const client = httpClient((request, response) => service.handler(request, response));
  assert.equal(
    (await client.request('GET', '/api/session')).json<{ mode: string }>().mode,
    'stream',
  );
  service = second;
  assert.equal(
    (await client.request('POST', '/api/inspect', { svg: moving })).status,
    200,
  );
  assert.equal(
    (
      await client.request(
        'POST',
        '/api/convert',
        { svg: moving },
        { origin: 'https://evil.example' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await client.request(
        'POST',
        '/api/convert',
        { svg: moving },
        { 'x-converter-token': '' },
      )
    ).status,
    403,
  );
  assert.equal(
    (await client.request('POST', '/api/inspect', { svg: ' '.repeat(4 * 1024 * 1024) }))
      .status,
    400,
  );
  for (const [width, height] of [
    [1280, 720],
    [1920, 1080],
  ]) {
    const response = await client.request('POST', '/api/convert', {
      svg: svg('<rect x="10" y="10" width="10" height="10" fill="red"/>'),
      options: { width, height },
    });
    assert.equal(response.status, 200);
    const events = streamEvents(response.body);
    assert.ok(events.some((event) => event.type === 'progress'));
    const done = events.at(-1);
    assert.equal(done?.type, 'done', response.body.toString());
    const gif = Buffer.concat(
      events.flatMap((event) =>
        event.type === 'chunk' ? [Buffer.from(event.data, 'base64')] : [],
      ),
    );
    const metadata = await sharp(gif).metadata();
    assert.equal(metadata.width, width);
    assert.equal(metadata.height, height);
    assert.equal((await sharp(gif).ensureAlpha().raw().toBuffer())[3], 0);
    if (done?.type === 'done') assert.equal(gif.length, done.result.bytes);
  }
});

test('streaming timeout and browser disconnect clean up workers and temporary files', async (context) => {
  const service = await createApi({ streaming: true, jobTimeout: 1 });
  context.after(() => service.close());
  const before = (await readdir(tmpdir()))
    .filter((name) => name.startsWith('svg-stream-'))
    .sort();
  const client = httpClient(service.handler);
  await client.request('GET', '/api/session');
  const response = await client.request('POST', '/api/convert', { svg: moving });
  const event = streamEvents(response.body).at(-1);
  assert.equal(event?.type, 'error');
  if (event?.type === 'error') assert.match(event.message, /too long/);
  assert.deepEqual(
    (await readdir(tmpdir())).filter((name) => name.startsWith('svg-stream-')).sort(),
    before,
  );

  const normal = await createApi({ streaming: true });
  context.after(() => normal.close());
  const controller = new AbortController();
  let completed: Promise<void> | undefined;
  const disconnecting = httpClient((request, response) => {
    completed = normal.handler(request, response);
    if (request.url === '/api/convert') setTimeout(() => controller.abort(), 30);
    return completed;
  });
  await disconnecting.request('GET', '/api/session');
  await assert.rejects(
    disconnecting.request(
      'POST',
      '/api/convert',
      { svg: moving, options: { width: 1920, height: 1080, duration: 5 } },
      {},
      controller.signal,
    ),
    /disconnected/,
  );
  await completed;
  assert.deepEqual(
    (await readdir(tmpdir())).filter((name) => name.startsWith('svg-stream-')).sort(),
    before,
  );
});

test('browser reads fragmented export streams and rejects incomplete GIF transfers', async (context) => {
  const result = { width: 16, height: 16, frames: 1, duration: 1, bytes: 3 };
  const events: ExportEvent[] = [
    { type: 'progress', progress: 0.5, message: 'Rendering' },
    { type: 'chunk', data: Buffer.from([1, 2, 3]).toString('base64') },
    { type: 'done', result },
  ];
  let content = events.map((event) => JSON.stringify(event) + '\n').join('');
  context.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            const bytes = new TextEncoder().encode(content);
            for (let offset = 0; offset < bytes.length; offset += 7)
              controller.enqueue(bytes.slice(offset, offset + 7));
            controller.close();
          },
        }),
      ),
  );
  let progress = 0;
  const output = await streamGif(
    {},
    'stream',
    4096,
    new AbortController().signal,
    (value) => {
      progress = value.progress;
    },
  );
  assert.equal(progress, 0.5);
  assert.deepEqual(Buffer.from(await output.blob.arrayBuffer()), Buffer.from([1, 2, 3]));
  content = JSON.stringify(events[1]) + '\n';
  await assert.rejects(
    streamGif({}, 'stream', 4096, new AbortController().signal, () => {}),
    /interrupted/,
  );
});

async function waitForJob(
  client: ReturnType<typeof httpClient>,
  id: string,
): Promise<JobSnapshot> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const job = (await client.request('GET', `/api/jobs/${id}`)).json<JobSnapshot>();
    if (job.state !== 'working') return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The test export did not finish.');
}

test('SMIL timing, easing, seeking, colors, and aspect ratio', () => {
  const document = new Document(moving);
  assert.deepEqual(document.metadata(), {
    width: 80,
    height: 40,
    animations: 1,
    duration: 1,
  });
  assert.equal(settings(document.metadata(), { width: 160 }).height, 80);
  document.snapshot(0.5, 80, 40);
  assert.equal(document.root.getElementsByTagName('rect')[0].getAttribute('x'), '30');
  document.snapshot(1.25, 80, 40);
  assert.equal(document.root.getElementsByTagName('rect')[0].getAttribute('x'), '15');
  const spline = new Document(
    svg(
      '<rect><animate attributeName="x" dur="1s" values="0;100;100" keyTimes="0;1;1" calcMode="spline" keySplines="0.42 0 1 1;0 0 1 1" fill="freeze"/></rect>',
    ),
  );
  spline.snapshot(0.5, 80, 40);
  assert.ok(Number(spline.root.getElementsByTagName('rect')[0].getAttribute('x')) < 50);
  spline.snapshot(2, 80, 40);
  assert.equal(spline.root.getElementsByTagName('rect')[0].getAttribute('x'), '100');
});

test('reject active content, external references, invalid XML, and excessive exports', () => {
  for (const content of [
    '<script>alert(1)</script>',
    '<image href="https://example.com/a.png"/>',
    '<rect onclick="x()"/>',
    '<style>@import "test";</style>',
    '<animateMotion dur="1s"/>',
  ]) {
    assert.throws(() => new Document(svg(content)));
  }
  for (const content of ['bad', '<svg/>', '<!DOCTYPE svg><svg/>', svg('<rect>')])
    assert.throws(() => new Document(content));
  for (const options of [
    { width: 5000 },
    { fps: 0 },
    { duration: NaN },
    { width: 16.5 },
    { width: 4096, height: 4096, duration: 60 },
    { dither: 'true' },
  ]) {
    assert.throws(() => settings(new Document(moving).metadata(), options));
  }
});

test('GIF transparency, motion, disposal, and total duration survive independent decoding', async (context) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'svg-test-'));
  context.after(() => rm(folder, { recursive: true, force: true }));
  const output = path.join(folder, 'result.gif');
  await convert(moving, output, { fps: 10, duration: 1.007 });
  const metadata = await sharp(output, { animated: true }).metadata();
  assert.equal(metadata.pages, 10);
  assert.equal(metadata.loop, 0);
  assert.equal(
    metadata.delay?.reduce((a, b) => a + b),
    1010,
  );
  const data = await sharp(output, { animated: true }).ensureAlpha().raw().toBuffer();
  const pixel = (x: number, y: number, frame = 0) =>
    Array.from(
      data.subarray(((frame * 40 + y) * 80 + x) * 4, ((frame * 40 + y) * 80 + x) * 4 + 4),
    );
  assert.equal(pixel(0, 0)[3], 0);
  assert.deepEqual(pixel(5, 15), [255, 0, 0, 255]);
  assert.equal(pixel(5, 15, 9)[3], 0);
  assert.deepEqual(pixel(60, 15, 9), [255, 0, 0, 255]);
});

test('black artwork stays opaque and solid exports have no transparent background', async (context) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'svg-test-'));
  context.after(() => rm(folder, { recursive: true, force: true }));
  for (const background of ['transparent', '#ffffff']) {
    const output = path.join(folder, `${background}.gif`);
    await convert(svg('<circle cx="40" cy="20" r="10" fill="black"/>'), output, {
      background,
      dither: true,
      loop: -1,
    });
    const data = await sharp(output).ensureAlpha().raw().toBuffer();
    assert.deepEqual(
      Array.from(data.subarray((20 * 80 + 40) * 4, (20 * 80 + 40) * 4 + 4)),
      [0, 0, 0, 255],
    );
    assert.equal(data[3], background === 'transparent' ? 0 : 255);
    assert.equal((await readFile(output)).includes(Buffer.from('NETSCAPE')), false);
  }
});

test('cancellation preserves existing output and removes unfinished files', async (context) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'svg-test-'));
  context.after(() => rm(folder, { recursive: true, force: true }));
  const output = path.join(folder, 'original.gif');
  await writeFile(output, 'original');
  const controller = new AbortController();
  await assert.rejects(
    convert(
      moving,
      output,
      { fps: 4 },
      {
        overwrite: true,
        signal: controller.signal,
        progress: (value) => {
          if (value > 0.7) controller.abort();
        },
      },
    ),
    Cancelled,
  );
  assert.equal(await readFile(output, 'utf8'), 'original');
  assert.deepEqual(await readdir(folder), ['original.gif']);
});

test('GIF LZW dictionary growth and reset preserve random indexed pixels', async () => {
  for (const colors of [2, 4, 16, 256]) {
    const palette = Array.from({ length: colors }, (_, index) => [
      index,
      255 - index,
      index,
    ]);
    let seed = 123456;
    const indices = Uint8Array.from({ length: 65536 }, () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) % colors;
    });
    const encoded = Buffer.concat([
      gifHeader(256, 256, palette, 0),
      gifFrame(indices, 256, 256, palette, 4, true),
      Buffer.from([0x3b]),
    ]);
    const data = await sharp(encoded).ensureAlpha().raw().toBuffer();
    for (let i = 0; i < indices.length; i++) {
      assert.equal(data[i * 4 + 3], indices[i] ? 255 : 0);
      if (indices[i]) assert.equal(data[i * 4], indices[i]);
    }
  }
});

test('public HTTPS origin, secure session cookies, and cross-origin rejection', async (context) => {
  const service = await createApi({ origin: 'https://studio.example' });
  context.after(() => service.close());
  const client = httpClient(service.handler, 'https://studio.example');
  assert.equal(
    (await client.request('GET', '/api/health', undefined, { host: '127.0.0.1:3000' }))
      .status,
    200,
  );
  const session = await client.request('GET', '/api/session');
  assert.match(String(session.headers['set-cookie']), /HttpOnly; SameSite=Lax;.*Secure/);
  assert.equal(
    (await client.request('POST', '/api/inspect', { svg: moving })).status,
    200,
  );
  assert.equal(
    (
      await client.request(
        'POST',
        '/api/inspect',
        { svg: moving },
        { origin: 'https://evil.example' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await client.request(
        'POST',
        '/api/inspect',
        { svg: moving },
        { 'x-converter-token': 'bad' },
      )
    ).status,
    403,
  );
});

test('exports belong to their browser session, and the compiled worker returns a GIF', async (context) => {
  const service = await createApi();
  context.after(() => service.close());
  const owner = httpClient(service.handler);
  const stranger = httpClient(service.handler);
  await owner.request('GET', '/api/session');
  await stranger.request('GET', '/api/session');
  const response = await owner.request('POST', '/api/convert', {
    svg: moving,
    options: { fps: 2 },
  });
  assert.equal(response.status, 202);
  const { id } = response.json<{ id: string }>();
  assert.equal((await stranger.request('GET', `/api/jobs/${id}`)).status, 404);
  assert.equal(
    (await stranger.request('POST', `/api/jobs/${id}/cancel`, {})).status,
    404,
  );
  assert.equal(
    (await owner.request('POST', '/api/convert', { svg: moving })).status,
    409,
  );
  assert.equal((await waitForJob(owner, id)).state, 'done');
  assert.equal((await stranger.request('GET', `/api/jobs/${id}/download`)).status, 404);
  const download = await owner.request('GET', `/api/jobs/${id}/download`);
  assert.equal(download.status, 200);
  assert.equal((await sharp(download.body).ensureAlpha().raw().toBuffer())[3], 0);
});

test('worker cancellation, job expiry, and session expiry are enforced', async (context) => {
  const service = await createApi({ resultLifetime: 150 });
  context.after(() => service.close());
  const client = httpClient(service.handler);
  await client.request('GET', '/api/session');
  const { id } = (
    await client.request('POST', '/api/convert', {
      svg: moving,
      options: { width: 640, duration: 10 },
    })
  ).json<{ id: string }>();
  assert.equal((await client.request('POST', `/api/jobs/${id}/cancel`, {})).status, 200);
  assert.equal((await waitForJob(client, id)).state, 'cancelled');
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal((await client.request('GET', `/api/jobs/${id}`)).status, 404);
  const shortSessionService = await createApi({ sessionLifetime: 20 });
  context.after(() => shortSessionService.close());
  const shortSession = httpClient(shortSessionService.handler);
  await shortSession.request('GET', '/api/session');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(
    (await shortSession.request('POST', '/api/inspect', { svg: moving })).status,
    403,
  );
});

test('bundled sample animation renders and changes between frames', async (context) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'svg-test-'));
  context.after(() => rm(folder, { recursive: true, force: true }));
  const source = await readFile(new URL('../public/sample.svg', import.meta.url), 'utf8');
  const output = path.join(folder, 'sample.gif');
  const result = await convert(source, output, { width: 160, fps: 2 });
  assert.equal(result.frames, 14);
  const data = await sharp(output, { animated: true }).ensureAlpha().raw().toBuffer();
  assert.notDeepEqual(
    data.subarray(0, 160 * 160 * 4),
    data.subarray(7 * 160 * 160 * 4, 8 * 160 * 160 * 4),
  );
});
