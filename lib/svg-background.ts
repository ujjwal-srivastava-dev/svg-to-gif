interface SvgElement {
  localName: string | null;
  parentNode: unknown;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  getElementsByTagName(name: string): ArrayLike<SvgElement>;
}

const artwork = new Set([
  'rect',
  'path',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'image',
  'use',
  'svg',
]);
const containers = new Set(['defs', 'clipPath', 'mask', 'pattern', 'marker', 'symbol']);
const close = (left: number, right: number) => Math.abs(left - right) < 0.001;

function length(value: string | null, total: number, fallback = 0): number {
  if (!value) return fallback;
  if (/^[-+\d.e]+%$/i.test(value)) return (parseFloat(value) * total) / 100;
  if (/^[-+\d.e]+(?:px)?$/i.test(value)) return parseFloat(value);
  return NaN;
}

function rectanglePath(data: string, box: number[]): boolean {
  const tokens = data.match(/[a-z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) || [];
  if (data.replace(/[a-z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?|[\s,]/gi, ''))
    return false;
  const points: number[][] = [];
  let x = 0;
  let y = 0;
  let command = '';
  let closed = false;

  for (let index = 0; index < tokens.length;) {
    if (/^[a-z]$/i.test(tokens[index])) command = tokens[index++];
    const upper = command.toUpperCase();
    const relative = command !== upper;
    if (upper === 'Z') {
      closed = index === tokens.length;
      break;
    }
    if (!['M', 'L', 'H', 'V'].includes(upper)) return false;
    const first = Number(tokens[index++]);
    if (!Number.isFinite(first)) return false;
    if (upper === 'H') x = first + (relative ? x : 0);
    else if (upper === 'V') y = first + (relative ? y : 0);
    else {
      const second = Number(tokens[index++]);
      if (!Number.isFinite(second)) return false;
      if (upper === 'M' && points.length) return false;
      x = first + (relative ? x : 0);
      y = second + (relative ? y : 0);
      if (upper === 'M') command = relative ? 'l' : 'L';
    }
    points.push([x, y]);
  }

  if (!closed) return false;
  if (
    points.length === 5 &&
    points[0].every((value, index) => close(value, points[4][index]))
  )
    points.pop();
  if (points.length !== 4) return false;
  const [left, top, width, height] = box;
  const corners = [
    [left, top],
    [left + width, top],
    [left + width, top + height],
    [left, top + height],
  ];
  return (
    corners.every((corner) =>
      points.some((point) => corner.every((value, index) => close(value, point[index]))),
    ) &&
    points.every((point, index) => {
      const next = points[(index + 1) % 4];
      return close(point[0], next[0]) || close(point[1], next[1]);
    })
  );
}

export function clearSvgBackground(root: SvgElement): void {
  const style = root.getAttribute('style') || '';
  root.setAttribute(
    'style',
    `${style};background:none!important;background-color:transparent!important`,
  );
  const values = (root.getAttribute('viewBox') || '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const box =
    values.length === 4 && values.every(Number.isFinite)
      ? values
      : [
          0,
          0,
          length(root.getAttribute('width'), 300, 300),
          length(root.getAttribute('height'), 150, 150),
        ];
  const [left, top, width, height] = box;

  for (const element of Array.from(root.getElementsByTagName('*'))) {
    if (!artwork.has(element.localName || '')) continue;
    let parent = element.parentNode as SvgElement | null;
    let definition = false;
    let altered = false;
    while (parent && parent !== root && typeof parent.getAttribute === 'function') {
      definition ||= containers.has(parent.localName || '');
      altered ||= Boolean(
        parent.getAttribute('transform') ||
        parent.getAttribute('clip-path') ||
        parent.getAttribute('mask') ||
        parent
          .getAttribute('style')
          ?.match(/transform|clip-path|mask|display\s*:\s*none/i),
      );
      altered ||= Array.from(parent.getElementsByTagName('animateTransform')).length > 0;
      parent = parent.parentNode as SvgElement | null;
    }
    if (definition) continue;
    if (
      altered ||
      ['transform', 'clip-path', 'mask', 'filter'].some((name) =>
        element.getAttribute(name),
      )
    )
      break;
    const id = element.getAttribute('id');
    if (
      id &&
      Array.from(root.getElementsByTagName('*')).some(
        (node) =>
          node.getAttribute('href') === `#${id}` ||
          node.getAttribute('xlink:href') === `#${id}`,
      )
    )
      break;
    if (
      Array.from(element.getElementsByTagName('*')).some((child) =>
        ['animate', 'animateTransform', 'set'].includes(child.localName || ''),
      )
    )
      break;
    const elementStyle = element.getAttribute('style') || '';
    if (
      /transform|clip-path|mask|filter|(?:^|;)\s*(?:x|y|width|height|rx|ry)\s*:/i.test(
        elementStyle,
      )
    )
      break;

    const fullRectangle =
      element.localName === 'rect' &&
      close(length(element.getAttribute('x'), width), left) &&
      close(length(element.getAttribute('y'), height), top) &&
      close(length(element.getAttribute('width'), width), width) &&
      close(length(element.getAttribute('height'), height), height) &&
      !length(element.getAttribute('rx'), width) &&
      !length(element.getAttribute('ry'), height);
    const fullPath =
      element.localName === 'path' && rectanglePath(element.getAttribute('d') || '', box);
    if (!fullRectangle && !fullPath) break;
    const fill = element.getAttribute('fill') || '';
    const stroke = element.getAttribute('stroke');
    if (
      fill === 'none' ||
      (stroke && stroke !== 'none') ||
      /(?:^|;)\s*(?:fill\s*:\s*none|stroke\s*:)/i.test(elementStyle)
    )
      break;
    element.setAttribute('style', `${elementStyle};display:none!important`);
  }
}
