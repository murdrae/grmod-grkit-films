# GRKit film looks on GR III / IIIx films

GRKit (https://github.com/ahonn/grkit) runs its film looks from an SD-card script that loads 8–10 s
after power-on. GR Mod builds looks into the firmware as films (looks 64..83), which the camera
has from its normal start. This directory and `core/src/color/grkit.ts` take GRKit's definitions
(`third_party/grkit/effects`, licences in `third_party/grkit/NOTICE.md`) over as films.

- In the app: open the official GR III 2.20 (or 2.10, IIIx 1.70 / 1.60) file, add films, and drop an
  `effect.json` on a film card (the picker takes `.json` on GR III / IIIx).
- From the command line: `npx vite-node tools/grkit/convert.ts` writes `third_party/grkit/converted/`.
- Tests: `npm -w core test -- grkit`; with `GRMOD_GR3_220_FIRMWARE=/path/fwdc239b.bin` also a
  20-film 2.20 build that must pass GR Mod's self-check against the official file, reproducibly.

## What carries over

| GRKit | GR Mod film | |
|---|---|---|
| `matrix` (Q13, absolute look matrix, replaces Standard's) | `matrixQ13` (the film's tone record) | exact |
| `curves` / `curve_knots` (256 × 0..16383, indexed by base gamma / 64) | `curves` (the gamma stage's tables) | exact |
| `post_matrix` (Q13, folded into the YCbCr matrix at 1/256) | `postQ9` (matrix module post-curve fields) | rounded, ≤ 1/1024 per coefficient |
| `flags: 1` (packet black-and-white flag) | none: equal rows and curves give R = G = B | same picture |
| `hue_sectors` (the MultiAxial stage, 11 sectors × 4 levels, weight curve) | the film's own MultiAxial set, and a second one for highlight correction, built as GRKit's runtime builds them (`core/src/fw/gr3x170/multiaxis.ts`) | exact on GR III 2.20 / IIIx 1.70; dropped on 2.10 / 1.60 |
| `selective_color`, `native_look` | not available | refused (no shipped look uses them) |

Both programs take the film from Standard's tone record and use the camera's own base gamma, so the
numbers mean the same thing in both; nothing is refitted.

## How the hue sectors are installed (GR III 2.20 / IIIx 1.70)

Round 10 already gives each film its own entry in an 84-entry copy of the multi-axis table; it
held Standard's set. A film with hue sectors gets a set of its own there. With highlight correction
the camera halves the stage's input, so (as GRKit) the builder's store of the set (0x536dc290)
goes through a stub that takes a second set from a second table when the flag at [fp - 0x30] is
set. `tools/gr3x170/films_r10_verify.py` runs the builder for every look with the flag off and on,
and checks each film's sets; `verify_bytes.py` checks their numbers against the definitions.

## What dropping the hue sectors costs (GR III 2.10 / IIIx 1.60 only)

`python3 -I tools/grkit/sector_loss.py third_party/grkit/effects .` renders each look with GRKit's
own model (fit/model.rs, hue.rs, ported) with and without its sectors, CIEDE2000:

| look | chart mean | chart max | natural mean | natural p95 |
|---|---|---|---|---|
| Aerocolor IV | 0.83 | 2.74 | 0.52 | 1.88 |
| Fujicolor C200 | 1.95 | 11.95 | 1.30 | 5.23 |
| Ektachrome E100 | 1.00 | 2.83 | 0.64 | 2.22 |
| Ektar 100 | 1.53 | 5.82 | 1.03 | 3.67 |
| Eterna 500T | 3.15 | 10.05 | 1.64 | 6.17 |
| Gold 200 | 1.14 | 3.76 | 0.75 | 2.95 |
| Instax | 4.48 | 11.78 | 1.65 | 7.05 |
| Kodachrome 64 | 0.71 | 1.53 | 0.47 | 1.42 |
| Portra 400 | 0.96 | 3.67 | 0.92 | 3.67 |
| Portra 800 +2 | 1.63 | 8.20 | 1.15 | 4.12 |
| Pro 400H | 0.75 | 2.56 | 0.85 | 3.46 |
| Provia 100F | 1.08 | 2.64 | 0.67 | 2.15 |
| UltraMax 400 | 1.81 | 4.89 | 1.13 | 4.88 |
| Velvia 100 | 1.02 | 3.84 | 0.70 | 2.61 |
| Vision3 250D | 1.25 | 3.87 | 0.99 | 3.78 |
| Vision3 500T | 1.32 | 5.16 | 1.03 | 3.97 |
| Superia 400 | 1.73 | 7.74 | 1.33 | 5.31 |

The four black-and-white looks (Tri-X 400, Tri-X 400 Red, HP5 Plus 400, Double-X 5222) have no
sectors and are exact. For scale, GRKit's own fits are 0.5–1.6 mean (holdout) from their source LUTs.
The model uses GR Mod's IIIx Standard reference curve as the base gamma; it is a software model,
not a camera measurement.

## Building and installing (GR III 2.20)

1. Keep the official `fwdc239b.bin` from Ricoh's `gr3_v220.zip` (SHA-256 `5c53760b…793e`); Ricoh offers
   2.20 only until 2026-12-31. Both ways below refuse any other file.
2. Build, either
   - in the app (`shell/dist/grmod`): open the official file, add films (up to 20), drop an
     `effect.json` from `third_party/grkit/effects/<id>/` on each, add at least one ratio (GR III builds
     need one), switch on the date imprint if wanted, and write to a folder; or
   - `npx vite-node tools/grkit/build.ts OFFICIAL/fwdc239b.bin OUTDIR id,id,...` (default: the first 20).
3. Check the file (optional, also done by the app's self-check):
   ```sh
   python3 -I tools/grkit/verify_bytes.py OUTDIR third_party/grkit/effects id,id,...
   cd tools/gr3x170   # with unicorn==2.1.4 and capstone==5.0.7 (requirements.txt)
   python films_r10_verify.py --rtos OUTDIR/official.rtos --base OUTDIR/base.json --manifest OUTDIR/patch-manifest.json --report OUTDIR/r10.json
   python films_probe.py --rtos OUTDIR/official.rtos --manifest OUTDIR/patch-manifest.json --report OUTDIR/films.json
   ```
4. Before installing: turn GRKit off (remove its `SCRIPT` folder from the card and switch off the SD
   script setting). GRKit patches the running firmware by its own addresses and is made for the official
   firmware, not for one GR Mod has changed. Charge the battery, back up the card.
5. Copy `fwdc239b.bin` to the card's root, hold MENU while switching the camera on, choose Execute, OK
   (as an official update). Same version, so the camera accepts it.
6. Back to the official firmware: Setup › Reset › Reset to Factory Default first (films and the ratio
   are values the official firmware does not know), then install the official `fwdc239b.bin` the same way.

## Not checked in software

What the camera renders, how soon after power-on the first picture has the film's colours, and live
view: those need the camera (see the main README's GR III test procedure).
