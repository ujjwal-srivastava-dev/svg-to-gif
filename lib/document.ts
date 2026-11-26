import { DOMParser } from '@xmldom/xmldom';
import type { SvgMetadata, ConversionSettings } from './types.ts';

export const MAX_INPUT = 10 * 1024 * 1024;
export class ConversionError extends Error {}
export class Cancelled extends ConversionError {}
const SVG_NS = 'http://www.w3.org/2000/svg';

export function seconds(value: string): number {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(ms|s|min|h)?$/.exec(value.trim());
  if (!match)
    throw new ConversionError(
      `Unsupported animation time: ${value}. Use numeric times such as 500ms or 2s.`,
    );
  return (
    Number(match[1]) *
    (({ ms: 0.001, s: 1, min: 60, h: 3600 } as Record<string, number>)[match[2]] ?? 1)
  );
}

export function inspect(svg: unknown): SvgMetadata {
  if (typeof svg !== 'string' || !svg.trim())
    throw new ConversionError('Choose an SVG file.');
  if (Buffer.byteLength(svg) > MAX_INPUT)
    throw new ConversionError('SVG files must be 10 MB or smaller.');
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(svg))
    throw new ConversionError('DTD and entity declarations are unsupported.');
  let doc;
  try {
    doc = new DOMParser({
      onError: (level, message) => {
        throw new Error(message);
      },
    }).parseFromString(svg, 'image/svg+xml');
  } catch {
    throw new ConversionError('Invalid SVG XML. Export a valid, self-contained SVG.');
  }
  const root = doc.documentElement;
  if (
    root?.localName !== 'svg' ||
    root.namespaceURI !== SVG_NS ||
    root.getAttribute('xmlns') !== SVG_NS
  )
    throw new ConversionError('Use an SVG root with xmlns="http://www.w3.org/2000/svg".');
  const viewBox = (root.getAttribute('viewBox') || '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const validBox =
    viewBox.length === 4 &&
    viewBox.every(Number.isFinite) &&
    viewBox[2] > 0 &&
    viewBox[3] > 0;
  if (root.hasAttribute('viewBox') && !validBox)
    throw new ConversionError(
      'viewBox must contain four finite numbers with positive width and height.',
    );
  const dimension = (name: string, fallback: number): number => {
    const value = root.getAttribute(name) || '';
    return /^(?:\d+(?:\.\d*)?|\.\d+)(?:px)?$/.test(value) ? parseFloat(value) : fallback;
  };
  const width = dimension('width', validBox ? viewBox[2] : 300);
  const height = dimension('height', validBox ? viewBox[3] : 150);
  if (width <= 0 || height <= 0 || !Number.isFinite(width + height))
    throw new ConversionError('SVG dimensions must be positive and finite.');
  let animations = 0;
  let duration = 0;
  for (const element of Array.from(root.getElementsByTagName('*')).concat(root)) {
    const tag = (element.localName ?? '').toLowerCase();
    if (element.namespaceURI !== SVG_NS || ['script', 'foreignobject'].includes(tag))
      throw new ConversionError(
        'Scripts, foreignObject, and non-SVG elements are unsupported.',
      );
    for (const attr of Array.from(element.attributes)) {
      const name = (attr.localName ?? '').toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith('on') || attr.name === 'xml:base')
        throw new ConversionError(
          'Event handlers and external base URLs are unsupported.',
        );
      if (
        name === 'href' &&
        !value.startsWith('#') &&
        !/^data:image\/(png|jpeg|webp);base64,/i.test(value)
      )
        throw new ConversionError(
          'External assets are unsupported. Embed images in the SVG first.',
        );
    }
    const style =
      Array.from(element.attributes, (a) => a.value).join(' ') +
      (tag === 'style' ? element.textContent : '');
    if (
      /\\|@import|@keyframes|(?:^|[;{\s])(?:-\w+-)?(?:animation|transition)\s*[:\-]/i.test(
        style,
      )
    )
      throw new ConversionError(
        'CSS animations, imported styles, and escaped CSS are unsupported. Export SMIL animation instead.',
      );
    for (const match of style.matchAll(/url\s*\((.*?)\)/gi)) {
      if (
        !match[1]
          .trim()
          .replace(/^['"]|['"]$/g, '')
          .startsWith('#')
      )
        throw new ConversionError('Only local url(#fragment) references are supported.');
    }
    if (
      !['animate', 'animatetransform', 'animatemotion', 'animatecolor', 'set'].includes(
        tag,
      )
    )
      continue;
    const target = element.getAttribute('attributeName') || '';
    if (/href|^on|style|base/i.test(target))
      throw new ConversionError(
        'Animating links, styles, or event handlers is unsupported.',
      );
    const begin = seconds(element.getAttribute('begin') || '0s');
    const dur = seconds(element.getAttribute('dur') || '');
    if (dur <= 0) throw new ConversionError('Animation durations must be positive.');
    const repeatText = element.getAttribute('repeatCount') || '1';
    const repeats =
      repeatText === 'indefinite' ? 1 : finite(repeatText, 'Repeat count', 0.001, 10000);
    if (element.hasAttribute('end') || element.hasAttribute('repeatDur'))
      throw new ConversionError('Animation end events and repeatDur are unsupported.');
    duration = Math.max(duration, begin + dur * repeats);
    animations++;
  }
  return { width, height, animations, duration: Math.max(0.02, duration || 1) };
}

function finite(
  value: unknown,
  name: string,
  min: number,
  max: number,
  whole = false,
): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '')
    throw new ConversionError(`${name} must be a number.`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (whole && !Number.isInteger(n)))
    throw new ConversionError(
      `${name} must be ${whole ? 'a whole number ' : ''}between ${min} and ${max}.`,
    );
  return n;
}

export function settings(meta: SvgMetadata, input: unknown = {}): ConversionSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new ConversionError('Invalid export options.');
  const options = input as Record<string, unknown>;
  let { width, height } = options;
  if (width == null && height == null) {
    width = Math.round(meta.width);
    height = Math.round(meta.height);
  } else if (height == null)
    height = Math.round((Number(width) * meta.height) / meta.width);
  else if (width == null) width = Math.round((Number(height) * meta.width) / meta.height);
  width = finite(width, 'Width', 16, 4096, true);
  height = finite(height, 'Height', 16, 4096, true);
  const fps = finite(options.fps ?? 25, 'Frame rate', 1, 50);
  const duration = finite(options.duration ?? meta.duration, 'Duration', 0.02, 120);
  const start = finite(options.start ?? 0, 'Start time', 0, 3600);
  const count = meta.animations ? Math.max(1, Math.round(duration * fps)) : 1;
  if (count > 1800 || Number(width) * Number(height) * count > 800_000_000)
    throw new ConversionError(
      'Export is too large. Reduce dimensions, frame rate, or duration.',
    );
  const colors = finite(options.colors ?? 256, 'Colors', 16, 256, true);
  const loop = finite(options.loop ?? 0, 'Loop count', -1, 65535, true);
  const background = options.background ?? 'transparent';
  if (
    typeof background !== 'string' ||
    (background !== 'transparent' && !/^#[\da-f]{6}$/i.test(background))
  )
    throw new ConversionError('Background must be transparent or a #RRGGBB color.');
  if (options.dither != null && typeof options.dither !== 'boolean')
    throw new ConversionError('Dither must be true or false.');
  return {
    width: Number(width),
    height: Number(height),
    fps,
    duration,
    start,
    count,
    colors,
    loop,
    background,
    dither: options.dither ?? false,
  };
}
