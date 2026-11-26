import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { ExportEvent, JobSnapshot } from '../lib/types.ts';
import { httpClient, type HttpHandler } from './http-client.ts';

Object.assign(process.env, {
  NODE_ENV: 'production',
  APP_ORIGIN: 'https://studio.example',
});

const require = createRequire(import.meta.url);
const route = require('../.next/server/pages/api/[...path].js') as {
  default: HttpHandler;
};
const html = await readFile(
  new URL('../.next/server/pages/index.html', import.meta.url),
  'utf8',
);
assert.match(html, /Keep it moving/);
assert.match(html, /Convert to GIF/);
assert.match(html, /_next\/static\/.*\.css/);
const client = httpClient(route.default, 'https://studio.example');

try {
  assert.equal((await client.request('GET', '/api/health')).status, 200);
  await client.request('GET', '/api/session');
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="10" fill="red"/></svg>';
  assert.equal((await client.request('POST', '/api/inspect', { svg })).status, 200);
  const response = await client.request('POST', '/api/convert', { svg });
  assert.equal(response.status, 202);
  const { id } = response.json<{ id: string }>();
  let job: JobSnapshot | undefined;

  for (let attempt = 0; attempt < 100; attempt++) {
    job = (await client.request('GET', `/api/jobs/${id}`)).json<JobSnapshot>();
    if (job.state !== 'working') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  assert.equal(job?.state, 'done', job?.message);
  const output = await client.request('GET', `/api/jobs/${id}/download`);
  assert.equal(output.status, 200);
  const image = await sharp(output.body).ensureAlpha().raw().toBuffer();
  assert.equal(image[3], 0);
  assert.equal(image[(20 * 40 + 20) * 4 + 3], 255);
  console.log(
    'Production page, HTTPS sessions, compiled worker, download, and GIF transparency verified.',
  );
} finally {
  const state = globalThis as typeof globalThis & {
    svgStudioApi?: Promise<{ close(): Promise<void> }>;
  };
  await (await state.svgStudioApi)?.close();
  delete state.svgStudioApi;
}

const root = process.cwd();
const packaged = await mkdtemp(path.join(tmpdir(), 'svg-deployment-'));
const tracePath = path.join(root, '.next/server/pages/api/[...path].js.nft.json');
const trace = JSON.parse(await readFile(tracePath, 'utf8')) as { files: string[] };
const files = new Set(
  trace.files.map((file) => path.resolve(path.dirname(tracePath), file)),
);
files.add(path.join(root, '.next/server/pages/api/[...path].js'));
for (const file of await readdir(path.join(root, 'dist'))) {
  if (file.endsWith('.js'))
    assert.ok(
      files.has(path.join(root, 'dist', file)),
      `Deployment is missing dist/${file}`,
    );
}
const previousVercel = process.env.VERCEL;

try {
  for (const source of files) {
    const relative = path.relative(root, source);
    assert.ok(!relative.startsWith('..'), `Trace escaped the project: ${relative}`);
    const target = path.join(packaged, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  process.chdir(packaged);
  process.env.VERCEL = '1';
  const packagedRoute = require(
    path.join(packaged, '.next/server/pages/api/[...path].js'),
  ) as { default: HttpHandler };
  const client = httpClient(packagedRoute.default, 'https://studio.example');
  const session = await client.request('GET', '/api/session');
  assert.equal(session.json<{ mode: string }>().mode, 'stream');
  const response = await client.request('POST', '/api/convert', {
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><circle cx="80" cy="45" r="20" fill="red"><animate attributeName="cx" values="40;100" dur="1s"/></circle></svg>',
    options: { width: 1920, height: 1080, fps: 2, duration: 1 },
  });
  assert.equal(response.status, 200);
  const events = response.body
    .toString()
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as ExportEvent);
  const done = events.at(-1);
  assert.equal(done?.type, 'done', JSON.stringify(done));
  const gif = Buffer.concat(
    events.flatMap((event) =>
      event.type === 'chunk' ? [Buffer.from(event.data, 'base64')] : [],
    ),
  );
  const metadata = await sharp(gif, { animated: true }).metadata();
  assert.equal(metadata.width, 1920);
  assert.equal(metadata.pageHeight, 1080);
  assert.equal(metadata.pages, 2);
  const pixels = await sharp(gif, { animated: true }).ensureAlpha().raw().toBuffer();
  assert.equal(pixels[3], 0);
  assert.notDeepEqual(
    pixels.subarray(0, 1920 * 1080 * 4),
    pixels.subarray(1920 * 1080 * 4),
  );
  console.log(
    'Traced deployment only: native dependencies, worker imports, streaming, animated 1080p GIF, and transparency verified.',
  );
} finally {
  const state = globalThis as typeof globalThis & {
    svgStudioApi?: Promise<{ close(): Promise<void> }>;
  };
  await (await state.svgStudioApi)?.close();
  delete state.svgStudioApi;
  process.chdir(root);
  if (previousVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = previousVercel;
  await rm(packaged, { recursive: true, force: true });
}
