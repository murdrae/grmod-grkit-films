# SPDX-License-Identifier: GPL-2.0-only
"""Check that a built GR III / IIIx firmware holds GRKit's numbers for each film.

  python3 -I tools/grkit/verify_bytes.py OUTDIR third_party/grkit/effects id,id,...

OUTDIR is what tools/grkit/build.ts wrote (built.rtos, patch-manifest.json); the ids in build order.
For film k: the matrix its tone record points to (record + 4) equals the definition's `matrix`, the
curve tables equal its `curves`, the post-curve matrix equals `post_matrix` rounded to Q9, and with
`hue_sectors` its MultiAxial set holds their matrices (Q10, level 4 = level 3) and weight curve.
"""
import json, math, struct, sys
from pathlib import Path

out, effects, ids = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3].split(',')
rtos = (out / 'built.rtos').read_bytes()
m = json.loads((out / 'patch-manifest.json').read_text())
BASE = 0x53000000
def at(addr, n):
    o = addr - BASE
    assert 0 <= o and o + n <= len(rtos), hex(addr)
    return rtos[o:o + n]
def q9(q13):
    q = [round(v / 16) for v in q13]  # Python's round is half to even, as the converter's
    for r in range(3): q[r * 4] = 512 - (q[r * 3] + q[r * 3 + 1] + q[r * 3 + 2] - q[r * 4])
    return q
def rnd(v): return math.copysign(math.floor(abs(v) + 0.5), v)  # Rust's round
def control(w):
    st = [rnd(x * 1024 / 255) for x in w]; br = [0, 164, 655, 4095]
    sl = [rnd((st[k + 1] - st[k]) * 32 / (br[k + 1] - br[k])) if k < 3 else 0 for k in range(4)]
    return [int(x) for x in st] + [int(x) & 0x1ff for x in sl] + [164, 655, 4095]
def mats(h):
    out = []
    for bank in range(12):
        for level in range(5):
            frm = (level if level < 4 else 3) if 'levels' in h else 0
            c = h['levels'][frm - 1] if frm else h['matrices']
            m = [1024, 0, 0, 0, 1024, 0, 0, 0, 1024]
            if bank:
                for r in range(3):
                    a, b = c[bank - 1][r * 2] * 8, c[bank - 1][r * 2 + 1] * 8
                    m[r * 3 + (r + 1) % 3], m[r * 3 + (r + 2) % 3], m[r * 4] = a, b, 1024 - a - b
            out += m
    return out
films = m['addedLooks']
assert len(films) == len(ids) == m['filmCount'], (len(films), len(ids))
for k, (film, eid) in enumerate(zip(films, ids)):
    d = json.loads((effects / eid / 'effect.json').read_text())
    assert film['id'] == 64 + k and film['name'] == d['name'], (film['id'], film['name'], d['name'])
    matrix_at = struct.unpack_from('<I', at(film['record'], 8), 4)[0]
    assert list(struct.unpack('<9h', at(matrix_at, 18))) == d['matrix'], f'{eid}: matrix'
    curves = struct.unpack('<768H', at(film['curves'], 1536))
    assert [list(curves[c * 256:(c + 1) * 256]) for c in range(3)] == d['curves'], f'{eid}: curves'
    want = q9(d['post_matrix']) if 'post_matrix' in d else None
    if want == [512, 0, 0, 0, 512, 0, 0, 0, 512]: want = None
    assert film.get('postQ9') == want, f'{eid}: post matrix'
    hs = d.get('hue_sectors')
    assert bool(hs) == bool(film.get('multiAxis')), f'{eid}: MultiAxial set'
    if hs:
        st = struct.unpack('<6I', at(film['multiAxis']['set'], 24))
        assert list(struct.unpack('<540i', at(struct.unpack('<I', at(st[2], 4))[0], 2160))) == mats(hs), f'{eid}: hue matrices'
        assert list(struct.unpack('<21H', at(st[4], 42)))[10:] == control(hs['weight']), f'{eid}: hue weight curve'
    print(f'{64 + k} {d["name"]:16s} matrix, curves{", post Q9" if want else ""}{", hue sectors" if hs else ""}: as GRKit')
print(f'{len(ids)} films checked in {out / "built.rtos"}')
