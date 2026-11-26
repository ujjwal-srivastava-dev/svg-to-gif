import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import type { JobSnapshot } from '../lib/types.ts';
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
