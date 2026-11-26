import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { errorMessage } from '../errors.ts';
import type {
  ConversionOptions,
  ConversionResult,
  ExportEvent,
  WorkerInput,
  WorkerUpdate,
} from '../types.ts';

export async function streamExport(
  response: ServerResponse,
  svg: string,
  options: ConversionOptions,
  timeout: number,
) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'svg-stream-'));
  const output = path.join(workspace, 'animation.gif');
  const controller = new AbortController();
  let worker: Worker | undefined;
  let timer: NodeJS.Timeout | undefined;
  let heartbeat: NodeJS.Timeout | undefined;
  let lastProgress = 0;
  const disconnect = () => controller.abort();
  response.once('close', disconnect);

  const send = (event: ExportEvent) => {
    if (response.destroyed || controller.signal.aborted) return false;
    return response.write(`${JSON.stringify(event)}\n`);
  };

  try {
    if (response.destroyed) return;
    response.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store, no-transform',
      'X-Content-Type-Options': 'nosniff',
      'X-Accel-Buffering': 'no',
    });
    send({ type: 'progress', progress: 0, message: 'Preparing export' });
    const workerData: WorkerInput = { svg, options, output, workspace };
    worker = new Worker(path.join(process.cwd(), 'dist', 'worker.js'), {
      workerData,
      execArgv: [],
    });
    const result = await new Promise<ConversionResult>((resolve, reject) => {
      let completed: ConversionResult | undefined;
      const abort = () => reject(new Error('Export cancelled.'));
      controller.signal.addEventListener('abort', abort, { once: true });
      worker!.once('exit', () => {
        controller.signal.removeEventListener('abort', abort);
        if (completed) resolve(completed);
        else reject(new Error('The conversion worker stopped unexpectedly.'));
      });
      worker!.once('error', reject);
      worker!.on('message', (update: WorkerUpdate) => {
        if (update.state === 'done' && update.result) completed = update.result;
        else if (update.state === 'error' || update.state === 'cancelled')
          reject(new Error(update.message));
        else {
          lastProgress = update.progress;
          send({ type: 'progress', progress: update.progress, message: update.message });
        }
      });
      timer = setTimeout(() => {
        reject(new Error('Export took too long. Reduce size, frame rate, or duration.'));
      }, timeout);
      heartbeat = setInterval(() => {
        send({ type: 'progress', progress: lastProgress, message: 'Processing export…' });
      }, 10_000);
      if (controller.signal.aborted) abort();
    });

    clearTimeout(timer);
    clearInterval(heartbeat);
    for await (const chunk of createReadStream(output, {
      highWaterMark: 64 * 1024,
      signal: controller.signal,
    })) {
      if (!send({ type: 'chunk', data: (chunk as Buffer).toString('base64') }))
        await once(response, 'drain', { signal: controller.signal });
    }
    send({ type: 'done', result });
  } catch (error) {
    if (!controller.signal.aborted) send({ type: 'error', message: errorMessage(error) });
  } finally {
    clearTimeout(timer);
    clearInterval(heartbeat);
    await worker?.terminate();
    await rm(workspace, { recursive: true, force: true });
    response.removeListener('close', disconnect);
    if (!response.destroyed) response.end();
  }
}
