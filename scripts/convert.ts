import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { convert } from '../lib/converter.ts';
import { errorMessage, hasErrorCode } from '../lib/errors.ts';

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      serve: { type: 'boolean' },
      port: { type: 'string' },
      width: { type: 'string' },
      height: { type: 'string' },
      fps: { type: 'string' },
      duration: { type: 'string' },
      start: { type: 'string' },
      colors: { type: 'string' },
      background: { type: 'string' },
      loop: { type: 'string' },
      dither: { type: 'boolean' },
      force: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(`Usage: npm run convert -- input.svg [-o output.gif] [options]
       npm run dev

--width N, --height N   Output pixels; preserve aspect ratio if one is omitted
--fps N                Frames per second, 1–50 (default 25)
--duration N           Seconds to export (default: detected SMIL duration)
--start N              Animation start offset in seconds
--background COLOR     transparent (default) or '#RRGGBB'
--colors N             Palette size, 16–256 (default 256)
--loop N               0 forever, -1 once, N additional plays
--dither               Dither colors for gradients
--force                Replace an existing output
--serve [--port N]     Launch the browser UI (default port 3000)`);
  } else if (values.serve) {
    const port = Number(values.port ?? 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('Port must be between 1 and 65535.');
    const compiler = spawn(
      process.execPath,
      [
        fileURLToPath(import.meta.resolve('typescript/bin/tsc')),
        '-p',
        'tsconfig.worker.json',
      ],
      { stdio: 'inherit' },
    );
    await new Promise<void>((resolve, reject) => {
      compiler.once('error', reject);
      compiler.once('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error('Could not compile the conversion worker.'));
      });
    });
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(import.meta.resolve('next/dist/bin/next')),
        'dev',
        '--webpack',
        '--hostname',
        '0.0.0.0',
        '--port',
        String(port),
      ],
      { stdio: 'inherit' },
    );
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => {
        process.exitCode = code ?? 1;
        resolve();
      });
    });
  } else {
    if (positionals.length !== 1)
      throw new Error(
        'Choose one SVG file, or run npm run dev for the browser UI. Use --help for options.',
      );
    const input = path.resolve(positionals[0]);
    const output = path.resolve(values.output || input.replace(/\.svg$/i, '') + '.gif');
    if (input === output) throw new Error('Input and output must be different files.');
    const controller = new AbortController();
    process.once('SIGINT', () => controller.abort());
    let last = -1;
    const result = await convert(await readFile(input, 'utf8'), output, values, {
      overwrite: values.force,
      signal: controller.signal,
      progress: (fraction, message) => {
        const percent = Math.round(fraction * 100);
        if (percent !== last) {
          process.stderr.write(`\r${percent}%  ${message}                 `);
          last = percent;
        }
      },
    });
    console.log(
      `\nSaved ${output}\n${result.width} × ${result.height} · ${result.frames} frames · ${result.duration}s · ${(result.bytes / 1048576).toFixed(2)} MB`,
    );
  }
} catch (error) {
  console.error(
    `\nError: ${hasErrorCode(error, 'EEXIST') ? 'Output already exists. Choose another filename or add --force.' : errorMessage(error)}`,
  );
  process.exitCode = 1;
}
