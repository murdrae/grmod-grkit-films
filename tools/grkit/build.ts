// SPDX-License-Identifier: GPL-2.0-only
/**
 * Build a GR III / IIIx firmware with GRKit looks as films, without the app (for checks and scripts).
 *
 *   npx vite-node tools/grkit/build.ts OFFICIAL.bin OUTDIR [id,id,...] [--no-date] [--golden-grid]
 *
 * ids are third_party/grkit/effects names (default: the first 20). One added ratio (the first
 * camera-tested one) is included, since GR III builds need one. Writes OUTDIR/fwdc239b.bin (or the
 * official file's name), OUTDIR/built.rtos, OUTDIR/official.rtos, OUTDIR/patch-manifest.json and
 * OUTDIR/base.json for the emulator probes in tools/gr3x170 (run-probes.sh), and prints what the app's self-check says about the file.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { Engine, fw, GR3X_T4_CUSTOM } from '../../core/src';
import { gr3BuildManifests } from '../../core/src/app/engine';
import { GR3X_FILM_IDS } from '../../core/src/fw/gr3x/look-resources';
import { buildGr3xAdjResearch } from '../../core/src/fw/gr3x170/adj';
import { planGr3xMenu } from '../../core/src/fw/gr3x170/geometry';

const args = process.argv.slice(2);
const noDate = args.includes('--no-date'), goldenGrid = args.includes('--golden-grid');
const [official, outDir, list] = args.filter(a => !a.startsWith('--'));
if (!official || !outDir) { console.error('usage: build.ts OFFICIAL.bin OUTDIR [id,id,...] [--no-date] [--golden-grid]'); process.exit(2); }
const effects = resolve(new URL('../../third_party/grkit/effects', import.meta.url).pathname);
const ids = list ? list.split(',') : readdirSync(effects).sort().slice(0, 20);
if (ids.length < 1 || ids.length > 20) { console.error('1 to 20 looks'); process.exit(2); }

const raw = new Uint8Array(readFileSync(official));
const engine = await Engine.open(raw);
if (engine.info.family !== 'gr3x') { console.error('not a GR III / IIIx official file'); process.exit(2); }
const requests = ids.map((id, i) => {
  const r = engine.convertPreset('grkit', readFileSync(join(effects, id, 'effect.json'), 'utf8'));
  r.warnings.forEach(w => console.log(`  note: ${w}`));
  return { slot: GR3X_FILM_IDS[i], preset: { matrixQ13: r.matrixQ13, curves: r.curves, ...(r.postQ9 ? { postQ9: r.postQ9 } : {}), ...(r.hue ? { hue: r.hue } : {}) }, names: { en: r.title } };
});
const ratios = GR3X_T4_CUSTOM.slice(0, 1).map(r => ({ ratio: r.ratio, name: r.name! }));
const built = await engine.buildFirmware(requests, ratios, [], { filmCount: ids.length, dateStamp: !noDate, ...(goldenGrid ? { goldenGrid } : {}) });
const summary = await engine.inspect(built.file);

mkdirSync(outDir, { recursive: true });
const rtos = (b: Uint8Array) => { const d = new fw.Firmware(b).decoded; const s = fw.sectionsOf(d).find(x => x.name === 'RTOS')!; return d.subarray(s.offset, s.offset + s.size); };
writeFileSync(join(outDir, basename(official)), built.file);
writeFileSync(join(outDir, 'built.rtos'), rtos(built.file));
writeFileSync(join(outDir, 'official.rtos'), rtos(raw));
// The base (ratio / ADJ) layer alone, as tools/gr3x170/build-t6.mjs gives films_r10_verify.py (GR III 2.20 / IIIx 1.70 only).
const features = { adjSoftFocus: false, ...(noDate ? {} : { dateImprint: true, dateMenu: 'submenu' as const }), round7: true, round8: true, round9: true, round10: true, ...(goldenGrid ? { goldenGrid } : {}) };
writeFileSync(join(outDir, 'base.json'), JSON.stringify(await buildGr3xAdjResearch(raw, planGr3xMenu(ratios), features)));
writeFileSync(join(outDir, 'patch-manifest.json'), JSON.stringify(gr3BuildManifests.get(built.sha256), null, 2) + '\n');
console.log(`${basename(official)}: ${ids.length} films, ratio ${ratios[0].name}, date imprint ${noDate ? 'off' : 'on'}${goldenGrid ? ', Golden Ratio grid' : ''}`);
console.log(`sha256 ${built.sha256}`);
const checks = Object.values(built.checks).every(v => v === true);
console.log(`build checks ${checks}; self-check: kind ${summary.kind}, verified ${summary.verified}, changed bytes ${summary.changedBytes}`);
if (!checks || !summary.verified) process.exit(1);
