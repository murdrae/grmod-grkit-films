// SPDX-License-Identifier: GPL-2.0-only
/**
 * GR III 2.20 / IIIx 1.70: the focus distance scale (snap and manual focus) labelled in feet.
 * The scale's labels are 30 x 20 icons that 0x53393280 sets in its metre branch: unit "m" (661),
 * then from the top 5 (136), 3 (134), 1 (131) and 0.3 (658), with "∞" (660). The marks stay
 * where they are; their labels become ft, 16, 10, 3.3 and 1 (5 m = 16.4 ft, 3 m = 9.8 ft,
 * 1 m = 3.3 ft, 0.3 m = 1 ft). "10" (132) and "1" (131) are the camera's; ft, 16 and 3.3 are
 * drawn here from its digits. The centimetre branch (macro) is left as it is.
 */
import { assembleWords } from '../aspect/arm';
import { FirmwareError } from '../types';

const fail = (m: string): never => { throw new FirmwareError('unexpected-layout', m); };
const one = (source: string, at: number) => assembleWords(source, at)[0] >>> 0;
const W = 30, H = 20, SIZE = W * H * 4;
export const SNAP_SCALE_ICONS = { unit: 661, infinity: 660, five: 136, three: 134, one: 131, ten: 132, six: 137, twelve: 133, point3: 658 } as const;

/** Over-composite `src` (RGBA, 30 x 20) onto `dst`, shifted right by `dx`. */
function over(dst: Uint8Array, src: Uint8Array, dx: number) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const tx = x + dx; if (tx < 0 || tx >= W) continue;
    const s = (y * W + x) * 4, d = (y * W + tx) * 4, a = src[s + 3] / 255;
    if (!a) continue;
    for (let c = 0; c < 3; c++) dst[d + c] = Math.round(src[s + c] * a + dst[d + c] * (1 - a));
    dst[d + 3] = Math.round(255 * (a + dst[d + 3] / 255 * (1 - a)));
  }
}

/** White strokes with a 1-pixel black outline, as the camera's labels. */
function stroke(ink: readonly string[]): Uint8Array {
  const px = new Uint8Array(SIZE);
  const on = (x: number, y: number) => y >= 0 && y < H && x >= 0 && x < W && ink[y]?.[x] === '#';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (on(x, y)) px.set([255, 255, 255, 255], i);
    else if ([-1, 0, 1].some(dy => [-1, 0, 1].some(dx => on(x + dx, y + dy)))) px.set([0, 0, 0, 255], i);
  }
  return px;
}

// "ft" in the weight of the camera's "m" (3-pixel strokes), centred as it.
const FT = [
  '',
  '          ####',
  '        ######',
  '        ###',
  '        ###       ###',
  '        ###       ###',
  '      ########  ########',
  '      ########  ########',
  '        ###       ###',
  '        ###       ###',
  '        ###       ###',
  '        ###       ###',
  '        ###       ###',
  '        ###       ###',
  '        ###       ###',
  '        ###       ####',
  '        ###        #####',
  '        ###         ###',
];

/** The three new labels from the camera's icons (`get(id)` = its 30 x 20 RGBA). */
export function drawSnapFeetIcons(get: (id: number) => Uint8Array) {
  const I = SNAP_SCALE_ICONS;
  for (const id of Object.values(I)) if (get(id).length !== SIZE) fail(`IIIx scale icon ${id}`);
  const alpha = (px: Uint8Array, x: number, y: number) => px[(y * W + x) * 4 + 3];
  // The digits are left-aligned glyphs: "1" fills columns 3..9, "6" 3..15, "3" 0..12, "0.3"'s "0" 0..11.
  const blankFrom = (px: Uint8Array, x0: number) => { for (let y = 0; y < H; y++) for (let x = x0; x < W; x++) if (alpha(px, x, y)) return false; return true; };
  if (!blankFrom(get(I.one), 10) || !blankFrom(get(I.six), 16) || !blankFrom(get(I.three), 13)) fail('IIIx scale digit layout');
  const sixteen = get(I.one).slice();
  over(sixteen, get(I.six), 6);
  const point = get(I.point3).slice();
  for (let y = 0; y < H; y++) for (let x = 0; x <= 11; x++) point.fill(0, (y * W + x) * 4, (y * W + x) * 4 + 4);
  over(point, get(I.three), 0);
  return { ft: stroke(FT), sixteen, threePointThree: point };
}

export interface Gr3xSnapProgram { patch(address: number, expected: number, replacement: number, reason: string): void }

const UNIT = 0x533932b4, FIVE = 0x533932cc, THREE = 0x533932d8, ONE = 0x533932e4, POINT3 = 0x533932f0;

/** Point the metre branch of the scale's labels at the feet ones. */
export function installGr3xSnapFeet(p: Gr3xSnapProgram, ids: { ft: number; sixteen: number; threePointThree: number }) {
  const I = SNAP_SCALE_ICONS;
  const set = (at: number, from: string, to: string) => p.patch(at, one(from, at), one(to, at), 'focus distance scale in feet');
  set(UNIT, `movw r1,#${I.unit}`, `movw r1,#${ids.ft}`);
  set(FIVE, `mov r1,#${I.five}`, `movw r1,#${ids.sixteen}`);
  set(THREE, `mov r1,#${I.three}`, `mov r1,#${I.ten}`);
  set(ONE, `mov r1,#${I.one}`, `movw r1,#${ids.threePointThree}`);
  set(POINT3, `movw r1,#${I.point3}`, `mov r1,#${I.one}`);
}
