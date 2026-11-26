import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type {
  ConversionOptions,
  JobSnapshot,
  WorkerInput,
  WorkerUpdate,
} from '../types.ts';
import type { ServerConfig } from './config.ts';

interface Job extends JobSnapshot {
  owner: string;
  workspace: string;
  output: string;
  worker: Worker;
  finished: Promise<void>;
  expires: number;
  timeout?: NodeJS.Timeout;
  killTimeout?: NodeJS.Timeout;
}

export class Jobs {
  private readonly entries = new Map<string, Job>();
  private readonly storage: string;
  private readonly config: ServerConfig;
  private pending = false;
  private closing = false;
  private readonly removeStorage: () => void;

  private constructor(storage: string, config: ServerConfig) {
    this.storage = storage;
    this.config = config;
    this.removeStorage = () => rmSync(storage, { recursive: true, force: true });
    process.once('exit', this.removeStorage);
  }

  static async create(config: ServerConfig): Promise<Jobs> {
    const storage = await mkdtemp(path.join(tmpdir(), 'svg-studio-jobs-'));
    return new Jobs(storage, config);
  }

  private find(id: string, owner: string): Job | undefined {
    const job = this.entries.get(id);
    return job?.owner === owner && job.expires > Date.now() ? job : undefined;
  }

  get(id: string, owner: string): JobSnapshot | undefined {
    const job = this.find(id, owner);
    if (!job) return undefined;

    return {
      state: job.state,
      progress: job.progress,
      message: job.message,
      result: job.result,
    };
  }

  async download(id: string, owner: string): Promise<Buffer | undefined> {
    const job = this.find(id, owner);
    return job?.state === 'done' ? readFile(job.output) : undefined;
  }

  cancel(id: string, owner: string): boolean {
    const job = this.find(id, owner);
    if (!job) return false;

    if (job.state === 'working') {
      job.worker.postMessage('cancel');
      job.killTimeout ??= setTimeout(() => {
        job.state = 'cancelled';
        job.message = 'Conversion cancelled.';
        void job.worker.terminate();
      }, 5000);
      job.killTimeout.unref();
    }

    return true;
  }

  async start(
    owner: string,
    svg: string,
    options: ConversionOptions,
  ): Promise<string | undefined> {
    if (
      this.closing ||
      this.pending ||
      [...this.entries.values()].some((job) => job.state === 'working')
    ) {
      return undefined;
    }

    this.pending = true;
    const id = randomBytes(16).toString('hex');
    const workspace = path.join(this.storage, id);

    try {
      await this.prune();

      while (this.entries.size >= this.config.maxJobs) {
        const oldest = this.entries.keys().next().value;
        if (!oldest) break;
        await this.remove(oldest);
      }

      await mkdir(workspace);
      const output = path.join(workspace, 'animation.gif');
      const workerData: WorkerInput = { svg, options, output, workspace };
      const worker = new Worker(path.join(process.cwd(), 'dist', 'worker.js'), {
        workerData,
        execArgv: [],
      });
      const job: Job = {
        owner,
        workspace,
        output,
        worker,
        finished: Promise.resolve(),
        expires: Date.now() + this.config.jobTimeout + this.config.resultLifetime,
        state: 'working',
        progress: 0,
        message: 'Preparing export',
      };

      this.entries.set(id, job);
      worker.on('message', (update: WorkerUpdate) => {
        Object.assign(job, update);
        if (update.state) {
          clearTimeout(job.timeout);
          clearTimeout(job.killTimeout);
          job.expires = Date.now() + this.config.resultLifetime;
        }
      });
      worker.on('error', (error) => {
        job.state = 'error';
        job.message = error.message;
      });
      job.finished = new Promise((resolve) => {
        worker.on('exit', async () => {
          clearTimeout(job.timeout);
          clearTimeout(job.killTimeout);

          if (job.state === 'working') {
            job.state = 'error';
            job.message = 'The conversion worker stopped unexpectedly.';
          }

          if (job.state !== 'done')
            await rm(workspace, { recursive: true, force: true }).catch(() => {});
          resolve();
        });
      });
      job.timeout = setTimeout(() => {
        job.message = 'Export exceeded the time limit.';
        this.cancel(id, owner);
      }, this.config.jobTimeout);
      job.timeout.unref();
      return id;
    } catch (error) {
      await rm(workspace, { recursive: true, force: true });
      throw error;
    } finally {
      this.pending = false;
    }
  }

  private async remove(id: string): Promise<void> {
    const job = this.entries.get(id);
    if (!job) return;
    await job.finished;
    this.entries.delete(id);
    await rm(job.workspace, { recursive: true, force: true });
  }

  async prune(): Promise<void> {
    for (const [id, job] of this.entries) {
      if (job.state !== 'working' && job.expires <= Date.now()) await this.remove(id);
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const [id, job] of this.entries) this.cancel(id, job.owner);
    await Promise.all([...this.entries.values()].map((job) => job.finished));
    process.removeListener('exit', this.removeStorage);
    await rm(this.storage, { recursive: true, force: true });
  }
}
