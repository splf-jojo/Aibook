import type { ControlPoint, AugmentationSettings } from "./handwriting-experiment.ts";

// Separable lower envelopes of parabolas: exact squared Euclidean EDT in O(w*h).
// Felzenszwalb/Huttenlocher, https://cs.brown.edu/people/pfelzens/dt/
function edtLine(f: Float64Array, n: number) {
  const v = new Int32Array(n), z = new Float64Array(n + 1), out = new Float64Array(n);
  let k = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]));
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k])); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; out[q] = (q - v[k]) ** 2 + f[v[k]]; }
  return out;
}
function distanceTo(mask: Uint8Array, width: number, height: number, target: number) {
  const field = new Float64Array(mask.length), line = new Float64Array(Math.max(width, height));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) line[x] = mask[y * width + x] === target ? 0 : 1e12;
    field.set(edtLine(line, width), y * width);
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) line[y] = field[y * width + x];
    const column = edtLine(line, height);
    for (let y = 0; y < height; y++) field[y * width + x] = Math.sqrt(column[y]);
  }
  return field;
}
/** Positive in ink, negative outside; distances to opposite pixel centres. */
export function signedDistance(mask: Uint8Array, width: number, height: number) {
  if (mask.length !== width * height || !mask.some(Boolean)) throw new Error("Empty glyph.");
  // Treat the area outside the raster as paper, including full-ink test images.
  const w = width + 2, h = height + 2, padded = new Uint8Array(w * h);
  for (let y = 0; y < height; y++) padded.set(mask.subarray(y * width, (y + 1) * width), (y + 1) * w + 1);
  const outside = distanceTo(padded, w, h, 0), inside = distanceTo(padded, w, h, 1);
  return Float64Array.from(mask, (_, i) => { const p = (Math.floor(i / width) + 1) * w + i % width + 1; return outside[p] - inside[p]; });
}
export function averageGlyphs(samples: Float32Array[], width: number, height: number) {
  if (!samples.length) throw new Error("No samples.");
  const density = new Float64Array(width * height), field = new Float64Array(width * height);
  for (const ink of samples) {
    if (ink.length !== density.length) throw new Error("Mismatched sample dimensions.");
    const sdf = signedDistance(Uint8Array.from(ink, v => Number(v >= .5)), width, height);
    for (let i = 0; i < ink.length; i++) { density[i] += ink[i] / samples.length; field[i] += sdf[i] / samples.length; }
  }
  return { density, field, shape: Uint8Array.from(field, v => Number(v >= 0)) };
}

const neighbours = (i: number, w: number) => [i - w, i - w + 1, i + 1, i + w + 1, i + w, i + w - 1, i - 1, i - w - 1];
/** Zhang–Suen thinning, then endpoints, branch nodes, bends and loop extrema. */
export function detectControlPoints(mask: Uint8Array, width: number, height: number): ControlPoint[] {
  const raster = mask.slice();
  for (let step = 0; step < Math.max(width, height); step++) {
    let removed = 0;
    for (let pass = 0; pass < 2; pass++) {
      const erase = [];
      for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
        const i = y * width + x; if (!raster[i]) continue;
        const p = neighbours(i, width).map(j => raster[j]), count = p.reduce((a, b) => a + b, 0);
        const transitions = p.reduce((sum, v, j) => sum + Number(!v && p[(j + 1) % 8] === 1), 0);
        if (count < 2 || count > 6 || transitions !== 1) continue;
        const a = pass ? p[0] * p[2] * p[6] : p[0] * p[2] * p[4];
        const b = pass ? p[0] * p[4] * p[6] : p[2] * p[4] * p[6];
        if (!a && !b) erase.push(i);
      }
      for (const i of erase) raster[i] = 0;
      removed += erase.length;
    }
    if (!removed) break;
  }
  const ids = Array.from(raster.keys()).filter(i => raster[i]);
  const candidates: { i: number; kind: ControlPoint["kind"]; score: number }[] = [];
  const linked = (i: number) => neighbours(i, width).filter(j => j >= 0 && j < raster.length && raster[j] && Math.abs(j % width - i % width) <= 1);
  for (const i of ids) {
    const ns = linked(i);
    const ring = neighbours(i, width).map(j => Number(ns.includes(j)));
    const branches = ring.reduce((sum, v, j) => sum + Number(!v && ring[(j + 1) % 8]), 0);
    if (ns.length <= 1) candidates.push({ i, kind: "endpoint", score: 4 });
    else if (branches >= 3) candidates.push({ i, kind: "junction", score: 3 });
    else if (ns.length === 2) {
      const walk = (first: number) => {
        let prev = i, current = first;
        for (let n = 0; n < 8; n++) { const next = linked(current).filter(j => j !== prev); if (next.length !== 1 || next[0] === i) break; prev = current; current = next[0]; }
        return [current % width - i % width, Math.floor(current / width) - Math.floor(i / width)];
      };
      const a = walk(ns[0]), b = walk(ns[1]), length = Math.hypot(...a) * Math.hypot(...b);
      const cosine = length ? (a[0] * b[0] + a[1] * b[1]) / length : -1;
      if (cosine > -.8) candidates.push({ i, kind: "bend", score: 1 + cosine });
    }
  }
  // Extrema in every connected component also cover loops and detached dots.
  const visited = new Set<number>();
  for (const start of ids) {
    if (visited.has(start)) continue;
    const component = [start]; visited.add(start);
    for (let k = 0; k < component.length; k++) for (const j of linked(component[k])) if (!visited.has(j)) { visited.add(j); component.push(j); }
    for (const score of [(i: number) => i % width, (i: number) => -i % width, (i: number) => Math.floor(i / width), (i: number) => -Math.floor(i / width)]) {
      const i = component.reduce((best, j) => score(j) < score(best) ? j : best);
      candidates.push({ i, kind: "extreme", score: .1 });
    }
  }
  const points: ControlPoint[] = [];
  for (const c of candidates.sort((a, b) => b.score - a.score || a.i - b.i)) {
    const x = c.i % width, y = Math.floor(c.i / width);
    if (points.some(p => Math.hypot(p.x - x, p.y - y) < 8)) continue;
    points.push({ id: `p${points.length + 1}`, x, y, kind: c.kind, movable: points.length === 0 });
    if (points.length === 24) break;
  }
  return points;
}

const kernel = (distance: number, radius: number) => { const r = distance / radius; return r >= 1 ? 0 : (1 - r) ** 4 * (4 * r + 1); };
function solve(matrix: number[][], values: number[]) {
  const a = matrix.map((row, i) => [...row, values[i]]), n = a.length;
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let j = i + 1; j < n; j++) if (Math.abs(a[j][i]) > Math.abs(a[pivot][i])) pivot = j;
    if (Math.abs(a[pivot][i]) < 1e-9) throw new Error("Control points are too close. Move them apart.");
    [a[i], a[pivot]] = [a[pivot], a[i]];
    const divisor = a[i][i]; for (let k = i; k <= n; k++) a[i][k] /= divisor;
    for (let j = 0; j < n; j++) if (j !== i) { const factor = a[j][i]; for (let k = i; k <= n; k++) a[j][k] -= factor * a[i][k]; }
  }
  return a.map(row => row[n]);
}
/** Inverse compact-support RBF warp, interpolating both moving and fixed anchors. */
export function localWarp(points: ControlPoint[], targets: { x: number; y: number }[], radius: number) {
  const matrix = targets.map(a => targets.map(b => kernel(Math.hypot(a.x - b.x, a.y - b.y), radius)));
  const dx = solve(matrix, points.map((p, i) => p.x - targets[i].x));
  const dy = solve(matrix, points.map((p, i) => p.y - targets[i].y));
  return (x: number, y: number): [number, number] => {
    let sx = x, sy = y;
    targets.forEach((p, i) => { const weight = kernel(Math.hypot(x - p.x, y - p.y), radius); sx += weight * dx[i]; sy += weight * dy[i]; });
    return [sx, sy];
  };
}
export function augmentGlyph(shape: Uint8Array, width: number, height: number, points: ControlPoint[], settings: AugmentationSettings, seed: number) {
  let state = seed >>> 0;
  const random = () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const targets = points.map(p => {
    let angle = random() * Math.PI * 2;
    const direction = settings.direction;
    if (direction !== "free") {
      const base = { up: -Math.PI / 2, down: Math.PI / 2, left: Math.PI, right: 0, horizontal: random() < .5 ? 0 : Math.PI, vertical: random() < .5 ? -Math.PI / 2 : Math.PI / 2 }[direction];
      angle = base + (random() - .5) * Math.PI / 6;
    }
    const distance = p.movable ? settings.strength * (.5 + random() * .5) : 0;
    return { id: p.id, x: p.x + Math.cos(angle) * distance, y: p.y + Math.sin(angle) * distance };
  });
  if (targets.some(p => p.x < 2 || p.x > width - 3 || p.y < 2 || p.y > height - 3)) throw new Error("Deformation reaches the image edge. Reduce strength.");
  const map = localWarp(points, targets, settings.radius), output = new Float32Array(shape.length);
  const at = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height ? 0 : shape[y * width + x];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [sx, sy] = map(x, y), left = Math.floor(sx), top = Math.floor(sy), fx = sx - left, fy = sy - top;
    const value = at(left, top) * (1 - fx) * (1 - fy) + at(left + 1, top) * fx * (1 - fy) + at(left, top + 1) * (1 - fx) * fy + at(left + 1, top + 1) * fx * fy;
    output[y * width + x] = value;
    if ((x < 1 || y < 1 || x >= width - 1 || y >= height - 1) && value > .01) throw new Error("Deformation clips the glyph. Reduce strength.");
    // Reject folded maps, including the white region enclosed by a loop.
    const a = map(x + .25, y), b = map(x, y + .25);
    if (((a[0] - sx) * (b[1] - sy) - (a[1] - sy) * (b[0] - sx)) * 16 < .15) throw new Error("Deformation folds the glyph. Reduce strength or increase radius.");
  }
  return { pixels: output, targets, seed };
}
