import { randomUUID } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import {
  mkdtemp,
  readFile,
  writeFile,
  open,
  rename,
  link,
  unlink,
  rm,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { Document } from './animation.ts';
import { settings, Cancelled } from './document.ts';
import { hasErrorCode } from './errors.ts';
import { makePalette, indexFrame, gifHeader, gifFrame } from './gif.ts';
import type { ConversionOptions, ConversionResult } from './types.ts';

interface ConversionHooks {
  progress?: (progress: number, message: string) => void;
  signal?: AbortSignal;
  overwrite?: boolean;
  workspace?: string;
}

export async function convert(
  svg: string,
  output: string,
  options: ConversionOptions = {},
  {
    progress = () => {},
    signal,
    overwrite = false,
    workspace = tmpdir(),
  }: ConversionHooks = {},
): Promise<ConversionResult> {
  const document = new Document(svg);
  const cfg = settings(document.metadata(), options);
  const target = path.resolve(output);
  if (!overwrite) {
    try {
      await stat(target);
      throw Object.assign(
        new Error('Output already exists. Choose another filename or enable overwrite.'),
        { code: 'EEXIST' },
      );
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error;
    }
  }
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomUUID()}.tmp`,
  );
  const folder = await mkdtemp(path.join(workspace, 'svg-studio-'));
  let file: FileHandle | null = null;
  const check = () => {
    if (signal?.aborted) throw new Cancelled('Conversion cancelled.');
  };
  try {
    check();
    const sampleIndices = new Set(
      Array.from({ length: Math.min(35, cfg.count) }, (_, i) =>
        Math.round((i * (cfg.count - 1)) / Math.max(1, Math.min(35, cfg.count) - 1)),
      ),
    );
    const samples: Buffer[] = [];
    for (let i = 0; i < cfg.count; i++) {
      check();
      const snapshot = document.snapshot(
        cfg.start + (i * cfg.duration) / cfg.count,
        cfg.width,
        cfg.height,
      );
      let render = sharp(Buffer.from(snapshot), { limitInputPixels: 4096 * 4096 })
        .resize(cfg.width, cfg.height)
        .ensureAlpha();
      if (cfg.background !== 'transparent')
        render = render.flatten({ background: cfg.background }).ensureAlpha();
      const png = await render.png().toBuffer();
      await writeFile(path.join(folder, `${i}.png`), png);
      if (sampleIndices.has(i))
        samples.push(
          await sharp(png)
            .resize({ width: 192, height: 192, fit: 'inside', withoutEnlargement: true })
            .ensureAlpha()
            .raw()
            .toBuffer(),
        );
      progress((0.65 * (i + 1)) / cfg.count, `Rendering frame ${i + 1} of ${cfg.count}`);
    }
    check();
    const palette = makePalette(samples, cfg.colors);
    file = await open(temporary, 'wx');
    await file.write(gifHeader(cfg.width, cfg.height, palette, cfg.loop));
    const centiseconds = Math.round(cfg.duration * 100);
    for (let i = 0; i < cfg.count; i++) {
      check();
      const data = await sharp(await readFile(path.join(folder, `${i}.png`)))
        .ensureAlpha()
        .raw()
        .toBuffer();
      const indices = indexFrame(data, cfg.width, palette, cfg.dither);
      const delay =
        Math.round(((i + 1) * centiseconds) / cfg.count) -
        Math.round((i * centiseconds) / cfg.count);
      await file.write(
        gifFrame(
          indices,
          cfg.width,
          cfg.height,
          palette,
          delay,
          cfg.background === 'transparent',
        ),
      );
      progress(
        0.65 + (0.34 * (i + 1)) / cfg.count,
        `Encoding frame ${i + 1} of ${cfg.count}`,
      );
    }
    await file.write(Buffer.from([0x3b]));
    await file.close();
    file = null;
    check();
    if (overwrite) await rename(temporary, target);
    else {
      await link(temporary, target);
      await unlink(temporary);
    }
    const result = {
      width: cfg.width,
      height: cfg.height,
      frames: cfg.count,
      duration: centiseconds / 100,
      bytes: (await stat(target)).size,
    };
    progress(1, 'GIF ready');
    return result;
  } finally {
    await file?.close().catch(() => {});
    await rm(temporary, { force: true });
    await rm(folder, { recursive: true, force: true });
  }
}
