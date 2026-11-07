# GRKit film looks

`effects/<id>/effect.json` are the film-look definitions of [GRKit](https://github.com/ahonn/grkit)
(`effects/`, commit `d1e9a115a0f136994f3b7a981a1b2ab8e8de0381`), copied unchanged. GR Mod reads them
with `core/src/color/grkit.ts` (drop one on a GR III / IIIx film card, or `tools/grkit/convert.ts`);
`converted/` holds what that conversion gives for each, as GR Mod film presets.

They are **not** under GR Mod's GPL-2.0-only licence. Each keeps its own, named in its
`attribution.license`:

- **CC BY-SA 4.0** (Portra 400, Gold 200, Ektar 100, Pro 400H, Superia 400, Vision3 250D,
  Vision3 500T, Portra 800 +2, Kodachrome 64, Velvia 100, Ektachrome E100, Fujicolor C200,
  UltraMax 400, Provia 100F): fits by GRKit contributors of LUTs from
  [spektrafilm](https://github.com/andreavolpato/spektrafilm) 0.3.4 by Andrea Volpato
  (`licenses/SPEKTRAFILM_LICENSE.txt`, changes in `licenses/CHANGELOG.txt`).
- **MIT** (Tri-X 400, Tri-X 400 Red, Aerocolor IV, Eterna 500T, Instax, Double-X 5222): from
  [Spectral Film LUT](https://github.com/JanLohse/spectral_film_lut) by Jan Lohse
  (`licenses/SPECTRAL_FILM_LUT_LICENSE.txt`).
- **MIT** (HP5 Plus 400): from [t3mujinpack](https://github.com/t3mujin/t3mujinpack) by João Almeida
  (`licenses/T3MUJINPACK_LICENSE.txt`).

GRKit's code licence is `licenses/GRKIT_LICENSE.txt` (MIT, Copyright (c) 2026 ahonn); its effect
notice is `licenses/GRKIT_EFFECTS_NOTICE.md`; its fitting follows gr3-film-mods
(`licenses/GR3_FILM_MODS_LICENSE.txt`). `licenses/manifest.json` pins each source LUT by SHA-256.

The files in `converted/` are adaptations of these definitions (the post matrix rounded from Q13 to
Q9) and keep each definition's licence. A firmware file built with a
CC BY-SA 4.0 look contains that look's parameters: if you give such a file to anyone, give the
attribution above and keep those parameters under CC BY-SA 4.0.

Film, paper and filter names are trademarks of their owners. Neither GR Mod nor GRKit is
affiliated with or endorsed by Ricoh, Eastman Kodak Company, Kodak Alaris, Fujifilm or HARMAN
technology Limited.
