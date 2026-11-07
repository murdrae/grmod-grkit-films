// SPDX-License-Identifier: GPL-2.0-only
/**
 * GR III 2.20 / IIIx 1.70: a film's own MultiAxial set, from GRKit hue sectors (color/grkit.ts).
 *
 * The descriptor builder (0x536dc0cc) takes the look's set from the multi-axis table (round 10's
 * 84-entry copy, films-r10.ts) into the picture's descriptor (+0xc, 0x536dc290). A set is six words:
 * bounds (16 u16, four descending per Cb/Cr quadrant), bank selectors (20 u8, five segments per
 * quadrant), a header of five words each pointing to 60 3x3 i32 Q10 matrices (12 banks x 5 levels),
 * region values, 21 u16 control fields, the RGB to YCbCr matrix. Built as GRKit's runtime builds it
 * (runtime/install_effects.h `multiaxial`, MIT, Copyright (c) 2026 ahonn): GRKit's bounds and
 * selectors (11 equal sectors, sector k in bank k + 1, bank 0 the identity), the film's matrices
 * (level 4 repeats level 3), control fields 1..8 GRKit's level spread (0xfff without levels), 10..20
 * the film's weight curve, and Standard's region values and YCbCr matrix.
 *
 * With highlight correction (the builder's flag at [fp - 0x30], settings byte 0xb7e) the camera halves
 * the stage's input; GRKit then uses a second set whose control fields select the levels and weight of
 * twice the luminance (breakpoints halved, slopes doubled). The builder's store at 0x536dc290 goes
 * through a stub that takes the set from a second table when the flag is set.
 */
import type { GrkitHue } from '../../color/grkit';

export const GRKIT_BOUNDS = [1490, 745, 0, 0, 1304, 559, 0, 0, 1862, 1118, 373, 0, 1676, 931, 187, 0];
export const GRKIT_SELECTORS = [3, 2, 1, 0, 0, 11, 10, 9, 0, 0, 9, 8, 7, 6, 0, 6, 5, 4, 3, 0];
const LEVEL_CONTROL = [656, 656, 656, 586, 150, 650, 1150, 1650];
const LEVEL_CONTROL_HALVED = [1312, 1312, 1312, 1172, 75, 325, 575, 825];
const BORDERS = [164, 655, 4095];

/** Rust's f64::round (half away from zero). */
const round = (v: number) => Math.sign(v) * Math.round(Math.abs(v));

/** Control fields 10..20 (grkit-core hue.rs HueSectors::control): start weights, 9-bit slopes, breakpoints. */
export function grkitHueControl(weight: readonly number[]): number[] {
  const starts = weight.map(w => round(w * 1024 / 255));
  const breaks = [0, ...BORDERS];
  const slopes = [0, 1, 2, 3].map(k => k < 3 ? (starts[k + 1] - starts[k]) * 32 / (breaks[k + 1] - breaks[k]) : 0);
  return [...starts, ...slopes.map(s => round(s) & 0x1ff), ...BORDERS];
}

/** The 21 control fields of the set, and of the set for highlight correction. */
export function grkitSetControls(hue: GrkitHue): { control: number[]; halved: number[] } {
  const levels = hue.levels !== undefined;
  const fields = grkitHueControl(hue.weight);
  const control = [0, ...(levels ? LEVEL_CONTROL : Array(8).fill(0xfff)), 0, ...fields];
  const halved = [0, ...(levels ? LEVEL_CONTROL_HALVED : Array(8).fill(0xfff)), 0,
    ...control.slice(10, 14),
    ...control.slice(14, 18).map(c => { const s = Math.min(255, Math.max(-256, ((c & 0x1ff) - (c & 0x100 ? 0x200 : 0)) * 2)); return s & 0x1ff; }),
    ...control.slice(18, 21).map(c => c >> 1)];
  return { control, halved };
}

/** 60 Q10 matrices, bank-major (bank * 5 + level), as i32. */
export function grkitSetMatrices(hue: GrkitHue): number[] {
  const out: number[] = [];
  for (let bank = 0; bank < 12; bank++)
    for (let level = 0; level < 5; level++) {
      const from = hue.levels ? (level < 4 ? level : 3) : 0;
      const c = from ? hue.levels![from - 1] : hue.matrices;
      const m = [1024, 0, 0, 0, 1024, 0, 0, 0, 1024];
      for (let r = 0; bank && r < 3; r++) {
        const a = c[bank - 1][r * 2] * 8, b = c[bank - 1][r * 2 + 1] * 8;
        m[r * 3 + (r + 1) % 3] = a; m[r * 3 + (r + 2) % 3] = b; m[r * 4] = 1024 - a - b;
      }
      out.push(...m);
    }
  return out;
}

const bytes = (n: number, put: (v: DataView) => void) => { const b = new Uint8Array(n); put(new DataView(b.buffer)); return b; };
const u16s = (v: readonly number[]) => bytes(v.length * 2, d => v.forEach((x, i) => d.setUint16(i * 2, x, true)));
const u32s = (v: readonly number[]) => bytes(v.length * 4, d => v.forEach((x, i) => d.setUint32(i * 4, x >>> 0, true)));

/** Append a film's two sets; `standard` is Standard's set (its region values and YCbCr matrix are shared). */
export function appendGr3xMultiAxisSets(hue: GrkitHue, standard: { region: number; ycc: number }, append: (b: Uint8Array) => number): { set: number; halved: number } {
  const { control, halved } = grkitSetControls(hue);
  const bounds = append(u16s(GRKIT_BOUNDS));
  const selectors = append(Uint8Array.from(GRKIT_SELECTORS));
  const matrices = append(u32s(grkitSetMatrices(hue)));
  const header = append(u32s(Array(5).fill(matrices)));
  const c = append(u16s(control)), h = append(u16s(halved));
  return {
    set: append(u32s([bounds, selectors, header, standard.region, c, standard.ycc])),
    halved: append(u32s([bounds, selectors, header, standard.region, h, standard.ycc])),
  };
}

/** The builder's store of the set (str ip, [r4, #0xc]) and the flag's load before it. */
export const GR3X_SET_STORE = 0x536dc290, GR3X_SET_STORE_WORD = 0xe584c00c;
export const GR3X_HC_FLAG_LOAD = 0x536dc28c, GR3X_HC_FLAG_LOAD_WORD = 0xe51be030;
