// SPDX-License-Identifier: GPL-2.0-only
/**
 * GRKit effect definitions as GR III / IIIx films (color/grkit.ts).
 * The firmware part needs the official GR III 2.20 file in GRMOD_GR3_220_FIRMWARE and is skipped without it.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { convertGrkitEffect, grkitKnotCurve, isGrkitEffect, q13ToQ9 } from '../src/color/grkit';
import { quantizeSlot } from '../src/color/camera';
import { Engine } from '../src/app/engine';
import { grkitSetControls, grkitSetMatrices } from '../src/fw/gr3x170/multiaxis';
import { GR3X_FILM_IDS } from '../src/fw/gr3x/look-resources';
import { GR3X_T4_CUSTOM } from '../src';

const dir = new URL('../../third_party/grkit/', import.meta.url).pathname;
const ids = readdirSync(`${dir}effects`).sort();
const text = (id: string) => readFileSync(`${dir}effects/${id}/effect.json`, 'utf8');
/** GR III Standard's look matrix (GRKit fit/model.rs STANDARD_LOOK; the preview's reference). */
const STD = [8116, 743, -667, 15, 8598, -421, -244, 542, 7894];

describe('GRKit effects', () => {
  it('ships all 21 definitions, each detected as GRKit', () => {
    expect(ids.length).toBe(21);
    for (const id of ids) expect(isGrkitEffect(text(id))).toBe(true);
    expect(isGrkitEffect('TITLE "x"\nLUT_3D_SIZE 2')).toBe(false);
  });

  for (const id of ids) it(`${id}: matrix and curves exactly, post matrix within Q9 rounding`, () => {
    const d = JSON.parse(text(id));
    const g = convertGrkitEffect(text(id), STD);
    expect(Array.from(g.matrixQ13)).toEqual(d.matrix);
    g.curves.forEach((c, k) => expect(Array.from(c)).toEqual(d.curves[k]));
    if (d.post_matrix) {
      const q = g.postQ9!;
      for (let r = 0; r < 3; r++) expect(q[r * 3] + q[r * 3 + 1] + q[r * 3 + 2]).toBe(512);
      // off-diagonal: half a Q9 step; the diagonal also takes the row's remainder (at most 1).
      q.forEach((v, i) => expect(Math.abs(v * 16 - d.post_matrix[i])).toBeLessThanOrEqual(i % 4 === 0 ? 24 : 8));
    } else expect(g.postQ9).toBeUndefined();
    expect(g.unsupported).toEqual([]);
    expect(g.hue).toEqual(d.hue_sectors);
    if (d.flags === 1) expect(g.warnings).toEqual([]);
    // The preview parameters are the same film relative to Standard: quantised back, the matrix again.
    const back = quantizeSlot(g.params, STD).matrixQ13;
    back.forEach((v, i) => expect(Math.abs(v - d.matrix[i])).toBeLessThanOrEqual(2));
  });

  it('expands curve_knots as GRKit does (ties to even)', () => {
    const c = grkitKnotCurve([[0, 0], [2, 1], [255, 16383]]);
    expect([c[0], c[1], c[2], c[255]]).toEqual([0, 0, 1, 16383]); // 0.5 rounds to 0
    expect(() => grkitKnotCurve([[1, 0], [255, 1]])).toThrow();
    const d = JSON.parse(text('trix-400-mono-v1'));
    const knots = [0, 1, 2].map(k => d.curves[k].map((v: number, i: number) => [i, v]));
    delete d.curves; d.curve_knots = knots;
    const g = convertGrkitEffect(JSON.stringify(d), STD);
    expect(Array.from(g.curves[0])).toEqual(JSON.parse(text('trix-400-mono-v1')).curves[0]);
  });

  it('refuses what it cannot carry over or what is malformed', () => {
    const base = JSON.parse(text('portra-400-endura-v1'));
    const bad = (patch: Record<string, unknown>) => () => convertGrkitEffect(JSON.stringify({ ...base, ...patch }), STD);
    expect(bad({ selective_color: {} })).toThrow(/selective_color/);
    expect(bad({ native_look: {} })).toThrow(/native_look/);
    expect(bad({ schema: 'x' })).toThrow();
    expect(bad({ matrix: [8192, 1, 0, 0, 8192, 0, 0, 0, 8192] })).toThrow(/rows of 8192/);
    expect(bad({ curves: [base.curves[0], base.curves[1], [...base.curves[2]].reverse()] })).toThrow(/non-decreasing/);
    expect(bad({ name: 'A name that is too long' })).toThrow();
    expect(() => convertGrkitEffect('{', STD)).toThrow();
  });

  it('builds MultiAxial control fields and matrices as GRKit\'s runtime', () => {
    const hue = convertGrkitEffect(text('portra-400-endura-v1'), STD).hue!;
    expect(hue.weight).toEqual([223, 65, 58, 192]);
    // Worked by hand: starts round(w * 1024 / 255), slopes round(dStart * 32 / dx) as 9 bits, borders.
    const { control, halved } = grkitSetControls(hue);
    expect(control).toEqual([0, 656, 656, 656, 586, 150, 650, 1150, 1650, 0, 895, 261, 233, 771, 388, 510, 5, 0, 164, 655, 4095]);
    expect(halved).toEqual([0, 1312, 1312, 1312, 1172, 75, 325, 575, 825, 0, 895, 261, 233, 771, 264, 508, 10, 0, 82, 327, 2047]);
    const m = grkitSetMatrices(hue);
    expect(m.length).toBe(60 * 9);
    expect(m.slice(0, 45)).toEqual(Array(5).fill([1024, 0, 0, 0, 1024, 0, 0, 0, 1024]).flat()); // bank 0: identity
    const [a, b, c2, d2, e, f] = hue.matrices[0]; // bank 1, level 0: sector 0
    expect(m.slice(45, 54)).toEqual([1024 - 8 * (a + b), 8 * a, 8 * b, 8 * d2, 1024 - 8 * (c2 + d2), 8 * c2, 8 * e, 8 * f, 1024 - 8 * (e + f)]);
    // level 4 repeats level 3
    expect(m.slice((1 * 5 + 4) * 9, (1 * 5 + 5) * 9)).toEqual(m.slice((1 * 5 + 3) * 9, (1 * 5 + 4) * 9));
    for (let k = 0; k < 60; k++) expect(m[k * 9] + m[k * 9 + 1] + m[k * 9 + 2]).toBe(1024);
  });

  it('rounds Q13 to Q9 with rows of 512', () => {
    expect(Array.from(q13ToQ9([8192, 0, 0, 0, 8192, 0, 0, 0, 8192]))).toEqual([512, 0, 0, 0, 512, 0, 0, 0, 512]);
    expect(Array.from(q13ToQ9([8200, -8, 0, 8, 8176, 8, 0, 0, 8192]))).toEqual([512, 0, 0, 0, 512, 0, 0, 0, 512]);
  });

  it('converted/ is what the converter gives today', () => {
    for (const id of ids) {
      const g = convertGrkitEffect(text(id), STD);
      const c = JSON.parse(readFileSync(`${dir}converted/${id}.json`, 'utf8'));
      expect(c.preset).toEqual({ matrixQ13: Array.from(g.matrixQ13), curves: g.curves.map(x => Array.from(x)), ...(g.postQ9 ? { postQ9: Array.from(g.postQ9) } : {}), ...(g.hue ? { hue: g.hue } : {}) });
      expect(c.license).toBe(JSON.parse(text(id)).attribution.license);
    }
  });
});

const fw = process.env.GRMOD_GR3_220_FIRMWARE;
describe.skipIf(!fw || !existsSync(fw))('GRKit films in a GR III 2.20 build', () => {
  it('builds 20 films, verifies against the official file, reproducibly', async () => {
    const raw = new Uint8Array(readFileSync(fw!));
    const engine = await Engine.open(raw);
    expect(engine.info.family).toBe('gr3x');
    const chosen = ids.filter(id => id !== 'red-filter-mono-v1').slice(0, 20);
    const requests = chosen.map((id, i) => {
      const r = engine.convertPreset('grkit', text(id));
      expect(Array.from(r.matrixQ13)).toEqual(JSON.parse(text(id)).matrix);
      return { slot: GR3X_FILM_IDS[i], preset: { matrixQ13: r.matrixQ13, curves: r.curves, ...(r.postQ9 ? { postQ9: r.postQ9 } : {}) }, names: { en: r.title } };
    });
    const options = { filmCount: 20, dateStamp: true };
    // GR III builds need at least one added ratio (as the app's gr3xNeedRatio): the first camera-tested one.
    const ratios = GR3X_T4_CUSTOM.slice(0, 1).map(r => ({ ratio: r.ratio, name: r.name! }));
    const built = await engine.buildFirmware(requests, ratios, [], options);
    const again = await engine.buildFirmware(requests, ratios, [], options);
    expect(again.sha256).toBe(built.sha256);
    const s = await engine.inspect(built.file);
    expect(s.kind).toBe('modified');
    expect(s.verified).toBe(true);
    expect(s.dateStamp).toBe(true);
    const films = s.slots.filter(x => GR3X_FILM_IDS.includes(x.id as typeof GR3X_FILM_IDS[number]));
    expect(films.filter(x => x.colorChanged).length).toBe(20);
    expect(films.map(x => x.names.en)).toEqual(chosen.map(id => JSON.parse(text(id)).name));
    expect(s.goldenGrid).toBeUndefined();
  }, 600_000);

  it('adds Golden Ratio to Grid Style, recorded and verified', async () => {
    const engine = await Engine.open(new Uint8Array(readFileSync(fw!)));
    const ratios = GR3X_T4_CUSTOM.slice(0, 1).map(r => ({ ratio: r.ratio, name: r.name! }));
    const built = await engine.buildFirmware([], ratios, [], { dateStamp: true, goldenGrid: true });
    const s = await engine.inspect(built.file);
    expect(s.verified).toBe(true);
    expect(s.goldenGrid).toBe(true);
    // Round 9 (or older) builds have no Golden Ratio.
    await expect(engine.buildFirmware([], ratios, [], { goldenGrid: true, gr3Round: 9 })).rejects.toThrow(/Golden Ratio/);
  }, 600_000);

  it('labels Snap Focus Distance in feet, recorded and verified', async () => {
    const engine = await Engine.open(new Uint8Array(readFileSync(fw!)));
    const ratios = GR3X_T4_CUSTOM.slice(0, 1).map(r => ({ ratio: r.ratio, name: r.name! }));
    const built = await engine.buildFirmware([], ratios, [], { dateStamp: true, goldenGrid: true, snapFeet: true });
    const s = await engine.inspect(built.file);
    expect(s.verified).toBe(true);
    expect(s.snapFeet).toBe(true);
    expect(s.goldenGrid).toBe(true);
    await expect(engine.buildFirmware([], ratios, [], { snapFeet: true, gr3Round: 9 })).rejects.toThrow(/feet/);
  }, 600_000);
});
