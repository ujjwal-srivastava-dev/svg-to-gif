import Color from '@img/colour';
import { DOMParser, XMLSerializer, type Element } from '@xmldom/xmldom';
import { inspect, ConversionError, seconds } from './document.ts';
import type { SvgMetadata } from './types.ts';

interface Animation {
  target: Element;
  attribute: string;
  original: string | null;
  begin: number;
  duration: number;
  repeat: number;
  values: string[];
  times: number[];
  splines: number[][];
  mode: string;
  transform: string | null;
  freeze: boolean;
}

const NUMBER = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g;
const ATTRIBUTES = new Set(
  'transform opacity fill-opacity stroke-opacity stroke-width stroke-dasharray stroke-dashoffset x y x1 y1 x2 y2 cx cy r rx ry width height d points viewBox fill stroke color stop-color stop-opacity offset display visibility'.split(
    ' ',
  ),
);
function ease(x: number, [x1, y1, x2, y2]: number[]): number {
  const bez = (t: number, a: number, b: number) =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 35; i++) {
    const mid = (lo + hi) / 2;
    if (bez(mid, x1, x2) < x) lo = mid;
    else hi = mid;
  }
  return bez((lo + hi) / 2, y1, y2);
}
export function interpolate(
  left: string,
  right: string,
  amount: number,
  attribute: string,
): string {
  if (amount <= 0 || left === right) return left;
  if (amount >= 1) return right;
  if (['fill', 'stroke', 'stop-color', 'flood-color', 'color'].includes(attribute)) {
    try {
      const a = Color(left);
      const b = Color(right);
      if (a.alpha() !== 1 || b.alpha() !== 1) throw new Error();
      const from = a.rgb().array();
      const to = b.rgb().array();
      return (
        '#' +
        from
          .map((v, i) =>
            Math.round(v + (to[i] - v) * amount)
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')
      );
    } catch {
      throw new ConversionError('Animated colors must be explicit opaque colors.');
    }
  }
  const skeleton = (s: string) => s.replace(NUMBER, '#').replace(/[\s,]+/g, '');
  const a = left.match(NUMBER);
  const b = right.match(NUMBER);
  if (!a || !b || a.length !== b.length || skeleton(left) !== skeleton(right))
    throw new ConversionError(
      `Cannot interpolate ${attribute}: use matching numeric values or calcMode="discrete".`,
    );
  let i = 0;
  return left.replace(NUMBER, () => {
    const n = Number(a[i]) + (Number(b[i]) - Number(a[i])) * amount;
    i++;
    return String(Number(n.toPrecision(10)));
  });
}

export class Document {
  readonly meta: SvgMetadata;
  readonly root: Element;
  readonly animations: Animation[];

  constructor(svg: string) {
    this.meta = inspect(svg);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    if (!doc.documentElement) throw new ConversionError('The SVG root is missing.');
    this.root = doc.documentElement;
    if (!this.root.hasAttribute('viewBox'))
      this.root.setAttribute('viewBox', `0 0 ${this.meta.width} ${this.meta.height}`);
    const elements = Array.from(this.root.getElementsByTagName('*'));
    const ids = new Map(
      elements.filter((e) => e.hasAttribute('id')).map((e) => [e.getAttribute('id'), e]),
    );
    this.animations = [];
    const seen = new Map<Element, Set<string>>();
    for (const node of elements) {
      const tag = node.localName ?? '';
      if (['animateMotion', 'animateColor'].includes(tag))
        throw new ConversionError(
          `<${tag}> is unsupported. Use animate or animateTransform.`,
        );
      if (!['animate', 'animateTransform', 'set'].includes(tag)) continue;
      const get = (name: string, fallback = ''): string =>
        node.getAttribute(name) ?? fallback;
      const href = get('href', get('xlink:href'));
      const target = href ? ids.get(href.slice(1)) : (node.parentNode as Element | null);
      if (!target) throw new ConversionError(`Animation target ${href} does not exist.`);
      const attribute = get('attributeName');
      if (!ATTRIBUTES.has(attribute))
        throw new ConversionError(`Animation of ${attribute} is unsupported.`);
      if (!seen.has(target)) seen.set(target, new Set());
      if (seen.get(target)!.has(attribute))
        throw new ConversionError(
          `Multiple animations of the same ${attribute} attribute are unsupported.`,
        );
      seen.get(target)!.add(attribute);
      if (
        get('additive', 'replace') !== 'replace' ||
        get('accumulate', 'none') !== 'none' ||
        node.hasAttribute('by')
      )
        throw new ConversionError(
          'Additive, accumulated, and by animations are unsupported. Use explicit values or from/to.',
        );
      const mode = tag === 'set' ? 'discrete' : get('calcMode', 'linear');
      if (!['linear', 'spline', 'discrete'].includes(mode))
        throw new ConversionError(`Unsupported calcMode: ${mode}.`);
      const begin = seconds(get('begin', '0s'));
      const duration = seconds(get('dur'));
      const repeat =
        get('repeatCount', '1') === 'indefinite'
          ? Infinity
          : Number(get('repeatCount', '1'));
      let values = node.hasAttribute('values')
        ? get('values')
            .split(';')
            .map((v) => v.trim())
        : [get('from', target.getAttribute(attribute) || ''), get('to')];
      if (tag === 'set') values = [get('to')];
      if (values.some((v) => !v))
        throw new ConversionError('Animations need values or explicit from/to values.');
      const times = node.hasAttribute('keyTimes')
        ? get('keyTimes').split(';').map(Number)
        : values.map(
            (_, i) =>
              i / (mode === 'discrete' ? values.length : Math.max(1, values.length - 1)),
          );
      if (
        times.length !== values.length ||
        times[0] !== 0 ||
        times.some(
          (v, i) => !Number.isFinite(v) || v < 0 || v > 1 || (i > 0 && v < times[i - 1]),
        ) ||
        (mode !== 'discrete' && values.length > 1 && times.at(-1) !== 1)
      )
        throw new ConversionError('Invalid animation keyTimes.');
      const splines =
        mode === 'spline'
          ? get('keySplines')
              .split(';')
              .map((v) =>
                v
                  .trim()
                  .split(/[\s,]+/)
                  .map(Number),
              )
          : [];
      if (
        mode === 'spline' &&
        (splines.length !== values.length - 1 ||
          splines.some(
            (v) => v.length !== 4 || v.some((n) => !Number.isFinite(n) || n < 0 || n > 1),
          ))
      )
        throw new ConversionError('Invalid animation keySplines.');
      const transform = tag === 'animateTransform' ? get('type') : null;
      if (
        tag === 'animateTransform' &&
        (attribute !== 'transform' ||
          !['translate', 'scale', 'rotate', 'skewX', 'skewY'].includes(transform ?? ''))
      )
        throw new ConversionError('Unsupported animateTransform type or target.');
      if (mode !== 'discrete')
        for (let i = 0; i < values.length - 1; i++)
          interpolate(values[i], values[i + 1], 0.5, attribute);
      this.animations.push({
        target,
        attribute,
        original: target.hasAttribute(attribute) ? target.getAttribute(attribute) : null,
        begin,
        duration,
        repeat,
        values,
        times,
        splines,
        mode,
        transform,
        freeze: get('fill') === 'freeze',
      });
      node.parentNode?.removeChild(node);
    }
  }
  metadata() {
    return { ...this.meta };
  }
  snapshot(time: number, width: number, height: number): string {
    for (const a of this.animations) {
      if (a.original === null) a.target.removeAttribute(a.attribute);
      else a.target.setAttribute(a.attribute, a.original);
      const elapsed = time - a.begin;
      const end = a.duration * a.repeat;
      if (elapsed < 0 || (elapsed >= end && !a.freeze)) continue;
      const phase =
        elapsed >= end ? a.repeat % 1 || 1 : (elapsed % a.duration) / a.duration;
      let i = 0;
      while (i + 1 < a.times.length && a.times[i + 1] <= phase) i++;
      let value = a.values[i];
      if (a.mode !== 'discrete' && i < a.values.length - 1) {
        const span = a.times[i + 1] - a.times[i];
        let fraction = span ? (phase - a.times[i]) / span : 1;
        if (a.mode === 'spline') fraction = ease(fraction, a.splines[i]);
        value = interpolate(value, a.values[i + 1], fraction, a.attribute);
      }
      a.target.setAttribute(
        a.attribute,
        a.transform ? `${a.transform}(${value})` : value,
      );
    }
    this.root.setAttribute('width', String(width));
    this.root.setAttribute('height', String(height));
    const originalStyle = this.root.getAttribute('style') || '';
    this.root.setAttribute(
      'style',
      originalStyle.replace(/(?:^|;)\s*(?:width|height)\s*:[^;]*/gi, '') +
        `;width:${width}px;height:${height}px`,
    );
    return new XMLSerializer().serializeToString(this.root);
  }
}
