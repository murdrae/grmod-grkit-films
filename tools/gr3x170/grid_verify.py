# SPDX-License-Identifier: GPL-2.0-only
"""Run GridView's draw (0x5339c4a0) of a built GR III 2.20 / IIIx 1.70 RTOS for each grid type and
check the lines it asks for (core/src/fw/gr3x170/grid.ts):

  python grid_verify.py BUILT.rtos [OFFICIAL.rtos]

Type 2 (Golden Ratio) must give 2-pixel lines at start + round(span * f) - 1, f = 25033 / 65536 and
40503 / 65536, each way; with OFFICIAL.rtos, types 0 and 1 must give exactly the official lines.
"""
import struct, sys
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_ARM, UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_PC, UC_ARM_REG_LR, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_SP

B, DRAW, DRAW_RECT, BASE_DRAW, STOP = 0x53000000, 0x5339c4a0, 0x5339c1a0, 0x533abaac, 0x5f000000
BOXES = [(0, 0, 720, 480), (0, 0, 720, 405), (60, 0, 660, 480), (90, 0, 630, 480)]

def lines(rtos, kind, box):
    mu = Uc(UC_ARCH_ARM, UC_MODE_ARM)
    size = (len(rtos) + 0xfffff) & ~0xfffff
    mu.mem_map(B, size); mu.mem_write(B, rtos)
    mu.mem_map(0x5e000000, 0x200000); mu.mem_map(STOP, 0x1000)
    this = 0x5e100000
    obj = bytearray(0x200); obj[0x9e] = 1; obj[0xf4] = kind; obj[0xf5] = 0x10
    struct.pack_into('<4i', obj, 0x30, box[0], box[1], box[2] - box[0], box[3] - box[1])
    mu.mem_write(this, bytes(obj))
    out = []
    def hook(uc, addr, _size, _):
        if addr == DRAW_RECT: out.append(struct.unpack('<4i', uc.mem_read(uc.reg_read(UC_ARM_REG_R2), 16)))
        if addr in (DRAW_RECT, BASE_DRAW): uc.reg_write(UC_ARM_REG_PC, uc.reg_read(UC_ARM_REG_LR))
    mu.hook_add(UC_HOOK_CODE, hook, begin=B, end=B + size)
    mu.reg_write(UC_ARM_REG_SP, 0x5e0f0000); mu.reg_write(UC_ARM_REG_R0, this); mu.reg_write(UC_ARM_REG_R1, 0x5e180000)
    mu.reg_write(UC_ARM_REG_LR, STOP)
    mu.emu_start(DRAW, STOP, count=200000)
    return out

def golden(box):
    x0, y0, x1, y1 = box
    at = lambda s, e, f: s + (((e - s) * f + 0x8000) >> 16) - 1
    return ([(x0, at(y0, y1, f), x1 - x0, 2) for f in (25033, 40503)] +
            [(at(x0, x1, f), y0, 2, y1 - y0) for f in (25033, 40503)])

built = open(sys.argv[1], 'rb').read()
official = open(sys.argv[2], 'rb').read() if len(sys.argv) > 2 else None
for box in BOXES:
    got = lines(built, 2, box)
    assert got == golden(box), (box, got, golden(box))
    if official:
        for kind in (0, 1): assert lines(built, kind, box) == lines(official, kind, box), (box, kind)
    print(box, 'Golden Ratio', [r[1] if r[2] > 2 else r[0] for r in got])
print('grid: Golden Ratio lines as expected' + ('; 3x3 and 4x4 as the official firmware' if official else ''))
