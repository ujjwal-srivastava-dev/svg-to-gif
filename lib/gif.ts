export function makePalette(samples: Uint8Array[], maxColors: number): number[][] {
  const histogram = new Map<number, number[]>();
  for (const data of samples) {
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      const item = histogram.get(key) || [0, 0, 0, 0];
      item[0] += data[i];
      item[1] += data[i + 1];
      item[2] += data[i + 2];
      item[3]++;
      histogram.set(key, item);
    }
  }
  const points = Array.from(histogram.values(), (p) => [
    p[0] / p[3],
    p[1] / p[3],
    p[2] / p[3],
    p[3],
  ]);
  if (!points.length)
    return [
      [0, 0, 0],
      [0, 0, 0],
    ];
  function box(points: number[][]) {
    const ranges = [0, 1, 2].map((c) => {
      let min = 255;
      let max = 0;
      for (const p of points) {
        min = Math.min(min, p[c]);
        max = Math.max(max, p[c]);
      }
      return max - min;
    });
    const axis = ranges.indexOf(Math.max(...ranges));
    const weight = points.reduce((sum, p) => sum + p[3], 0);
    return {
      points,
      axis,
      weight,
      score: points.length > 1 ? ranges[axis] * Math.sqrt(weight) : -1,
    };
  }
  const boxes = [box(points)];
  while (boxes.length < maxColors - 1) {
    boxes.sort((a, b) => b.score - a.score);
    if (boxes[0].score < 0) break;
    const current = boxes.shift()!;
    current.points.sort((a, b) => a[current.axis] - b[current.axis]);
    let sum = 0;
    let split = 0;
    while (split < current.points.length - 1 && sum < current.weight / 2)
      sum += current.points[split++][3];
    boxes.push(box(current.points.slice(0, split)), box(current.points.slice(split)));
  }
  return [
    [0, 0, 0],
    ...boxes.map((b) =>
      [0, 1, 2].map((c) =>
        Math.round(b.points.reduce((sum, p) => sum + p[c] * p[3], 0) / b.weight),
      ),
    ),
  ];
}

export function indexFrame(
  data: Uint8Array,
  width: number,
  palette: number[][],
  dither = false,
): Uint8Array {
  const pixels = data.length / 4;
  const indexed = new Uint8Array(pixels);
  const cache = new Map<number, number>();
  function nearest(r: number, g: number, b: number): number {
    const key = (r << 16) | (g << 8) | b;
    if (cache.has(key)) return cache.get(key)!;
    let best = 1;
    let distance = Infinity;
    for (let i = 1; i < palette.length; i++) {
      const p = palette[i];
      const d = (r - p[0]) ** 2 + (g - p[1]) ** 2 + (b - p[2]) ** 2;
      if (d < distance) {
        distance = d;
        best = i;
      }
    }
    if (cache.size < 65536) cache.set(key, best);
    return best;
  }
  if (!dither) {
    for (let pixel = 0; pixel < pixels; pixel++) {
      const p = pixel * 4;
      if (data[p + 3] >= 128) indexed[pixel] = nearest(data[p], data[p + 1], data[p + 2]);
    }
    return indexed;
  }
  let row = new Float32Array((width + 2) * 3);
  let next = new Float32Array(row.length);
  for (let y = 0; y < pixels / width; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      const p = pixel * 4;
      const e = (x + 1) * 3;
      if (data[p + 3] < 128) continue;
      const rgb = [0, 1, 2].map((c) =>
        Math.max(0, Math.min(255, Math.round(data[p + c] + (dither ? row[e + c] : 0)))),
      );
      const index = nearest(rgb[0], rgb[1], rgb[2]);
      indexed[pixel] = index;
      if (dither)
        for (let c = 0; c < 3; c++) {
          const error = rgb[c] - palette[index][c];
          row[e + 3 + c] += (error * 7) / 16;
          next[e - 3 + c] += (error * 3) / 16;
          next[e + c] += (error * 5) / 16;
          next[e + 3 + c] += error / 16;
        }
    }
    [row, next] = [next, row];
    next.fill(0);
  }
  return indexed;
}

function word(n: number): Buffer {
  return Buffer.from([n & 255, (n >> 8) & 255]);
}

function lzw(indices: Uint8Array, minBits: number): Buffer {
  const clear = 1 << minBits;
  const end = clear + 1;
  let size = minBits + 1;
  let next = end + 1;
  let bits = 0;
  let bitCount = 0;
  const bytes: number[] = [];
  const dictionary = new Map<number, number>();
  function emit(code: number) {
    bits |= code << bitCount;
    bitCount += size;
    while (bitCount >= 8) {
      bytes.push(bits & 255);
      bits >>>= 8;
      bitCount -= 8;
    }
  }
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 256 + k;
    const found = dictionary.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next > (1 << size) - 1 && size < 12) size++;
    if (next < 4096) dictionary.set(key, next++);
    else {
      emit(clear);
      dictionary.clear();
      size = minBits + 1;
      next = end + 1;
    }
    prefix = k;
  }
  emit(prefix);
  if (next > (1 << size) - 1 && size < 12) size++;
  emit(end);
  if (bitCount) bytes.push(bits & 255);
  const blocks = [Buffer.from([minBits])];
  for (let i = 0; i < bytes.length; i += 255) {
    const part = Buffer.from(bytes.slice(i, i + 255));
    blocks.push(Buffer.from([part.length]), part);
  }
  blocks.push(Buffer.from([0]));
  return Buffer.concat(blocks);
}

export function gifHeader(
  width: number,
  height: number,
  palette: number[][],
  loop: number,
): Buffer {
  const bits = Math.max(1, Math.ceil(Math.log2(palette.length)));
  const table = Buffer.alloc((1 << bits) * 3);
  palette.forEach((color, i) => table.set(color, i * 3));
  const header = [
    Buffer.from('GIF89a'),
    word(width),
    word(height),
    Buffer.from([0x80 | 0x70 | (bits - 1), 0, 0]),
    table,
  ];
  if (loop >= 0)
    header.push(
      Buffer.from([0x21, 0xff, 11]),
      Buffer.from('NETSCAPE2.0'),
      Buffer.from([3, 1]),
      word(loop),
      Buffer.from([0]),
    );
  return Buffer.concat(header);
}

export function gifFrame(
  indices: Uint8Array,
  width: number,
  height: number,
  palette: number[][],
  delay: number,
  transparent: boolean,
): Buffer {
  return Buffer.concat([
    Buffer.from([0x21, 0xf9, 4, (2 << 2) | (transparent ? 1 : 0)]),
    word(delay),
    Buffer.from([0, 0]),
    Buffer.from([0x2c]),
    word(0),
    word(0),
    word(width),
    word(height),
    Buffer.from([0]),
    lzw(indices, Math.max(2, Math.ceil(Math.log2(palette.length)))),
  ]);
}
