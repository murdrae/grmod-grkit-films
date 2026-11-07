// SPDX-License-Identifier: GPL-2.0-only
/**
 * GRKit effect definitions to GR Mod GR III / IIIx film presets (core/src/color/grkit.ts).
 *
 *   npx vite-node tools/grkit/convert.ts [EFFECT.json | DIR ...] [--out DIR]
 *
 * Defaults: every third_party/grkit/effects/<id>/effect.json into third_party/grkit/converted/<id>.json.
 * Each output holds the film's `preset` (matrixQ13, curves, postQ9, hue: what a build request takes;
 * hue is built on GR III 2.20 / IIIx 1.70 only), its
 * name, what was left out, and the definition's licence and attribution, which the output keeps.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { convertGrkitEffect } from '../../core/src/color/grkit';

const root = resolve(new URL('../..', import.meta.url).pathname);
const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = at >= 0 ? args.splice(at, 2)[1] : join(root, 'third_party/grkit/converted');
const inputs = args.length ? args : [join(root, 'third_party/grkit/effects')];
const files = inputs.flatMap(p => statSync(p).isDirectory()
  ? readdirSync(p).map(d => join(p, d, 'effect.json')).filter(existsSync).sort()
  : [p]);
if (!files.length) { console.error('no effect.json found'); process.exit(2); }
mkdirSync(out, { recursive: true });
// The preview parameters are not written, so Standard's matrix does not matter here.
const IDENTITY_Q13 = [8192, 0, 0, 0, 8192, 0, 0, 0, 8192];
for (const f of files) {
  const g = convertGrkitEffect(readFileSync(f, 'utf8'), IDENTITY_Q13);
  const doc = {
    schema: 'grmod-gr3-film-v1', source: `grkit:${g.effectId}`, name: g.title,
    preset: { matrixQ13: Array.from(g.matrixQ13), curves: g.curves.map(c => Array.from(c)), ...(g.postQ9 ? { postQ9: Array.from(g.postQ9) } : {}), ...(g.hue ? { hue: g.hue } : {}) },
    notCarriedOver: g.unsupported, warnings: g.warnings, license: g.license, attribution: g.attribution,
  };
  writeFileSync(join(out, `${g.effectId}.json`), JSON.stringify(doc, null, 1) + '\n');
  console.log(`${g.effectId.padEnd(24)} ${g.title.padEnd(16)} ${g.license.padEnd(13)} ${g.hue ? 'with hue sectors' : 'no hue sectors'}`);
}
