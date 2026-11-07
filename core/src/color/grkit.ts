// SPDX-License-Identifier: GPL-2.0-only
/**
 * GRKit film-look definitions (`grkit-effect-v1`, https://github.com/ahonn/grkit, `effects/<id>/effect.json`)
 * as GR III / IIIx films.
 *
 * Both projects drive the same camera stages, so most of a definition goes over as it is:
 *  - `matrix` is GRKit's absolute look matrix (it takes the place of Standard's tone-record matrix, Q13,
 *    rows of 8192); a film's `matrixQ13` is written to the same place. Copied exactly.
 *  - `curves` (or `curve_knots`, expanded as GRKit does) are 256 entries of 0..16383 indexed by the base
 *    gamma's output / 64; a film's curves are the same table. Copied exactly.
 *  - `post_matrix` is Q13 after the curves; GRKit folds it into the YCbCr matrix (1/256 units), GR Mod
 *    writes it to the matrix module's post-curve fields in Q9. Rounded to Q9 (error at most 1/1024 per
 *    coefficient, finer than the 1/256 GRKit's own stage keeps).
 *  - `flags` 1 (monochrome): GRKit also sets the packet's black-and-white flag; a film has none, but the
 *    definition's equal rows and equal curves give R = G = B anyway.
 *  - `hue_sectors` (the camera's MultiAxial stage: 11 sectors x 4 levels and a weight curve) are kept as
 *    they are (`hue`); on GR III 2.20 / IIIx 1.70 each film gets a MultiAxial set of its own built from them
 *    as GRKit's runtime builds it (fw/gr3x170/multiaxis.ts). Other firmware drops them with a warning.
 * `selective_color` and `native_look` are refused, since without them the look would be a different one.
 */
import type { SlotParams } from './camera';
import { KN } from './camera';
import { ColorError, interp, roundHalfEven } from './math';

/** GRKit's stored hue sectors (crates/grkit-core/src/hue.rs HueSectors): six off-diagonal coefficients
 * in 1/128 per sector (row r: columns r + 1 and r + 2, mod 3), the weight in 1/255 at four luminance
 * knots, and optionally the sectors of levels 1 to 3. */
export interface GrkitHue {
  matrices: number[][];
  weight: number[];
  levels?: number[][][];
}

export interface GrkitFilm {
  effectId: string;
  title: string;
  matrixQ13: Int16Array;
  curves: [Uint16Array, Uint16Array, Uint16Array];
  postQ9?: Int16Array;
  hue?: GrkitHue;
  /** For the preview only: the film relative to Standard (M1 = matrix . Standard^-1, 17-knot curves). */
  params: SlotParams;
  /** GRKit's own CIEDE2000 fit error against its source LUT on colours the fit did not see, if given. */
  meanDE: number;
  p95DE: number;
  warnings: string[];
  unsupported: string[];
  license: string;
  attribution: unknown;
}

const bad = (m: string): never => { throw new ColorError('bad-input', `GRKit effect: ${m}`); };
const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/** True when the text is a GRKit effect definition (for the file picker's kind detection). */
export function isGrkitEffect(text: string): boolean {
  return /"schema"\s*:\s*"grkit-effect-v1"/.test(text.slice(0, 4096));
}

/** `curve_knots` to 256 entries, as GRKit's `interpolate_curve` (crates/grkit-core/src/effects.rs). */
export function grkitKnotCurve(knots: unknown): Uint16Array {
  if (!Array.isArray(knots) || knots.length < 2 || knots.some(p => !Array.isArray(p) || p.length !== 2 || !isInt(p[0], 0, 255) || !isInt(p[1], 0, 16383)))
    return bad('expected increasing curve knots from index 0 to 255');
  const k = knots as [number, number][];
  if (k[0][0] !== 0 || k[k.length - 1][0] !== 255 || k.some((p, i) => i > 0 && p[0] <= k[i - 1][0])) return bad('expected increasing curve knots from index 0 to 255');
  const out = new Uint16Array(256);
  for (let i = 0; i + 1 < k.length; i++) {
    const [left, low] = k[i], [right, high] = k[i + 1];
    for (let x = left; x < right; x++) out[x] = roundHalfEven(low + ((high - low) * (x - left)) / (right - left));
  }
  out[255] = k[k.length - 1][1];
  return out;
}

function inv3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 1e-9)) bad('Standard matrix is singular');
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

/** Q13 rows of 8192 to Q9 rows of 512 (the diagonal takes the remainder, so grey stays grey). */
export function q13ToQ9(q13: ArrayLike<number>): Int16Array {
  const q = Array.from(q13, v => roundHalfEven(v / 16));
  for (let r = 0; r < 3; r++) q[r * 4] = 512 - (q[r * 3] + q[r * 3 + 1] + q[r * 3 + 2] - q[r * 4]);
  if (q.some(v => v < -2047 || v > 2047)) bad('post matrix does not fit the camera\'s 12-bit range');
  return Int16Array.from(q);
}

function sectors(v: unknown, what: string): number[][] {
  if (!Array.isArray(v) || v.length !== 11 || v.some(m => !Array.isArray(m) || m.length !== 6 || m.some((x: unknown) => !isInt(x, -128, 127))))
    return bad(`${what}: expected 11 sectors of six coefficients -128..127`);
  // The camera's matrix registers are 12-bit: the diagonal, 1024 - 8 (a + b), must fit (GRKit's GRF check).
  for (const m of v as number[][]) for (let r = 0; r < 3; r++) { const d = 1024 - 8 * (m[r * 2] + m[r * 2 + 1]); if (d < -2048 || d > 2047) bad(`${what}: a diagonal does not fit 12 bits`); }
  return (v as number[][]).map(m => m.slice());
}
/** Validate `hue_sectors` as GRKit's HueSectors::from_json does. */
export function grkitHue(v: unknown): GrkitHue {
  const h = v as Record<string, unknown>;
  if (!h || typeof h !== 'object' || Object.keys(h).some(k => !['matrices', 'weight', 'levels'].includes(k))) return bad('hue_sectors: unexpected fields');
  const matrices = sectors(h.matrices, 'hue_sectors');
  if (!Array.isArray(h.weight) || h.weight.length !== 4 || h.weight.some(w => !isInt(w, 0, 255))) bad('hue_sectors: expected four weights 0..255');
  if (h.levels !== undefined && (!Array.isArray(h.levels) || h.levels.length !== 3)) bad('hue_sectors: expected three levels');
  return { matrices, weight: (h.weight as number[]).slice(), ...(h.levels !== undefined ? { levels: (h.levels as unknown[]).map((l, i) => sectors(l, `hue_sectors level ${i + 1}`)) } : {}) };
}

/** Convert one `effect.json`. `mStdQ13` is Standard's matrix from the opened firmware (preview only). */
export function convertGrkitEffect(text: string, mStdQ13: ArrayLike<number>): GrkitFilm {
  if (typeof text !== 'string' || text.length > 4 * 1024 * 1024) bad('missing or larger than 4 MiB');
  let d: Record<string, any>;
  try { d = JSON.parse(text); } catch { return bad('not JSON'); }
  if (!d || typeof d !== 'object' || d.schema !== 'grkit-effect-v1') bad('expected schema grkit-effect-v1');
  if (typeof d.effect_id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(d.effect_id)) bad('expected an effect_id');
  if (typeof d.name !== 'string' || !/^[\x20-\x7e]{1,16}$/.test(d.name)) bad('name must be 1 to 16 printable ASCII characters');
  if (d.flags !== 0 && d.flags !== 1) bad('flags must be 0 or 1');
  if (!d.attribution || typeof d.attribution !== 'object') bad('attribution is required');
  if (d.selective_color !== undefined) bad('selective_color is not supported on GR Mod films');
  if (d.native_look !== undefined) bad('native_look is not supported on GR Mod films');

  const m = d.matrix;
  if (!Array.isArray(m) || m.length !== 9 || !m.every(v => isInt(v, -32768, 32767)) || [0, 1, 2].some(r => m[r * 3] + m[r * 3 + 1] + m[r * 3 + 2] !== 8192))
    bad('matrix must be nine Q13 integers with rows of 8192');
  const raw = d.curve_knots !== undefined
    ? (Array.isArray(d.curve_knots) && d.curve_knots.length === 3 ? d.curve_knots.map(grkitKnotCurve) : bad('expected three curve-knot channels'))
    : d.curves;
  if (!Array.isArray(raw) || raw.length !== 3 || raw.some((c: unknown) => !(Array.isArray(c) || c instanceof Uint16Array) || (c as ArrayLike<number>).length !== 256))
    bad('expected three curves of 256 entries');
  const curves = (raw as ArrayLike<number>[]).map(c => {
    const a = Array.from(c);
    // GR Mod's film tables are non-decreasing 0..16383 (image-control.ts filmBytes).
    if (a.some((v, i) => !isInt(v, 0, 16383) || (i > 0 && v < a[i - 1]))) bad('curves must be non-decreasing 0..16383');
    return Uint16Array.from(a);
  }) as [Uint16Array, Uint16Array, Uint16Array];
  const p = d.post_matrix;
  if (p !== undefined && (!Array.isArray(p) || p.length !== 9 || !p.every(v => isInt(v, -32768, 32767)) || [0, 1, 2].some(r => p[r * 3] + p[r * 3 + 1] + p[r * 3 + 2] !== 8192)))
    bad('post_matrix must be nine Q13 integers with rows of 8192');
  if (d.flags === 1 && (p !== undefined || d.hue_sectors !== undefined)) bad('a monochrome effect has no post_matrix or hue_sectors');

  const postQ9 = p !== undefined ? q13ToQ9(p) : undefined;
  const identity = postQ9 && [512, 0, 0, 0, 512, 0, 0, 0, 512].every((v, i) => postQ9[i] === v);
  const warnings: string[] = [], unsupported: string[] = [];
  const hue = d.hue_sectors !== undefined ? grkitHue(d.hue_sectors) : undefined;
  if (d.flags === 1 && !(m.slice(0, 3).every((v: number, k: number) => v === m[3 + k] && v === m[6 + k]) && curves.every(c => c.every((v, i) => v === curves[0][i]))))
    warnings.push(`GRKit: ${d.name} is marked monochrome but its rows or curves differ; GR Mod has no black-and-white flag, so it may not be fully neutral.`);

  // Preview parameters, relative to Standard as GR Mod's model expects.
  const stdInv = inv3(Array.from(mStdQ13, v => v / 8192));
  const abs = m.map((v: number) => v / 8192);
  const M1 = [0, 1, 2].map(r => [0, 1, 2].map(c => abs[r * 3] * stdInv[c] + abs[r * 3 + 1] * stdInv[3 + c] + abs[r * 3 + 2] * stdInv[6 + c]));
  const idx = Float64Array.from({ length: 256 }, (_, i) => i);
  const ck = curves.map(c => Float64Array.from(KN, x => interp(Math.min(255, (x * 16383) / 64), idx, c) / 16383));
  const params: SlotParams = { M1, ck, ...(postQ9 && !identity ? { P2: [0, 1, 2].map(r => [0, 1, 2].map(c => postQ9[r * 3 + c] / 512)) } : {}) };

  const fit = d.attribution.fit ?? {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  return {
    effectId: d.effect_id, title: d.name, matrixQ13: Int16Array.from(m), curves,
    ...(postQ9 && !identity ? { postQ9 } : {}), ...(hue ? { hue } : {}),
    params, meanDE: num(fit.holdout_mean_de ?? fit.mean_de), p95DE: num(fit.holdout_p95_de ?? fit.max_de),
    warnings, unsupported, license: typeof d.attribution.license === 'string' ? d.attribution.license : 'unknown', attribution: d.attribution,
  };
}
