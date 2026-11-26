import { parentPort, workerData } from 'node:worker_threads';
import { convert } from './converter.ts';
import { Cancelled } from './document.ts';
import { errorMessage } from './errors.ts';
import type { WorkerInput, WorkerUpdate } from './types.ts';

if (!parentPort) {
  throw new Error('The conversion worker requires a parent thread.');
}

const port = parentPort;
const input = workerData as WorkerInput;
const controller = new AbortController();
const report = (update: WorkerUpdate) => port.postMessage(update);

port.on('message', (message: unknown) => {
  if (message === 'cancel') controller.abort();
});

try {
  const result = await convert(input.svg, input.output, input.options, {
    signal: controller.signal,
    workspace: input.workspace,
    progress: (progress, message) => report({ progress, message }),
  });

  report({ state: 'done', result, progress: 1, message: 'GIF ready' });
} catch (error) {
  report({
    state: error instanceof Cancelled ? 'cancelled' : 'error',
    progress: 0,
    message: errorMessage(error),
  });
} finally {
  port.close();
}
