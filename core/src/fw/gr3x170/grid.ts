// SPDX-License-Identifier: GPL-2.0-only
/**
 * GR III 2.20 / IIIx 1.70: a third Grid Style, Golden Ratio (the phi grid: one line each way at
 * 0.381966 and 0.618034 of the photo area, as GRKit's modules/guides "Golden Ratio", MIT).
 *
 * The camera's grid (GridView, vtable 0x53c0a3a8) draws 2-pixel lines inside the photo area; its
 * type byte (+0xf4) is the setting byte 0x8be: 0 "3x3 Grid" (2 lines each way), 1 "4x4 Grid"
 * (3 lines each way and the diagonals). Value 2 is Golden Ratio:
 *  - Grid Style's list (SelectMenuController record 88): count 3 (0x531b3d84, its only user), and
 *    the item <-> value table (0x53b58c90, shared with other lists) replaced by the identity in
 *    its three readers (draw, set, is current).
 *  - Value names and icons (0x53292ba4, 0x53293da8, used only by this setting): 2 -> the new ones.
 *  - The two places that hand the setting to the grid (0x53177654, 0x53178f18) accept 0..2 instead
 *    of 0..1 (any other value still shows no grid, as the camera does).
 *  - GridView's draw (0x5339c4a0) at its type read: type 2 draws the four golden lines with the
 *    camera's own rectangle and line calls (as its 3x3 loop: rows y - 1, y and columns x - 1, x, at
 *    start + round(span * f), f = 25033 / 65536 and 40503 / 65536), then joins the native end. The
 *    diagonals stay hidden (only type 1 shows them, 0x5339c354).
 */
import { assembleWords, branchWord } from '../aspect/arm';
import { FirmwareError } from '../types';

export interface Gr3xGridProgram {
  code(source: string): number;
  patch(address: number, expected: number, replacement: number, reason: string): void;
}

const fail = (m: string): never => { throw new FirmwareError('unexpected-layout', m); };
const one = (source: string, at: number) => assembleWords(source, at)[0] >>> 0;

const LIST_COUNT = 0x531b3d84, DRAW_MAP = 0x531b5d74, SET_MAP = 0x531b76fc, CURRENT_MAP = 0x531b8ed4;
const VALUE_TEXT = 0x53292ba4, VALUE_ICON = 0x53293da8;
const TYPE_CHECK_A = 0x53177654, TYPE_CHECK_B = 0x53178f18;
const GRID_TYPE_READ = 0x5339c4d8, GRID_TYPE_NEXT = 0x5339c4dc, GRID_DRAW_END = 0x5339c604;
const DRAW_RECT = 0x5339c1a0;
const RECT_X = 0x536b5810, RECT_Y = 0x536b5818, RECT_RIGHT = 0x536b5848, RECT_BOTTOM = 0x536b589c;
const RECT_NEW = 0x536b5694, RECT_SET = 0x536b571c, RECT_MOVE_X = 0x536b580c, RECT_MOVE_Y = 0x536b5814;
/** 0.381966 and 0.618034 of 65536 (GRKit's 25033 and 65536 - 25033). */
export const GR3X_GOLDEN = [25033, 40503] as const;

/** Install Golden Ratio as Grid Style value 2; `text` and `icon` are its added text and 60 x 40 icon ids. */
export function installGr3xGoldenGrid(p: Gr3xGridProgram, ids: { text: number; icon: number }) {
  if (ids.text > 0xffff || ids.icon > 0xffff) fail('IIIx grid ids');
  const same = (at: number, source: string, next: string, reason: string) => p.patch(at, one(source, at), one(next, at), reason);
  same(LIST_COUNT, 'mov r0,#2', 'mov r0,#3', 'Grid Style: three values');
  same(DRAW_MAP, 'ldrb r4,[r3,r4]', 'mov r4,r4', 'Grid Style list: item k is value k (draw)');
  same(SET_MAP, 'ldrb r1,[r3,r4]', 'mov r1,r4', 'Grid Style list: item k is value k (set)');
  same(CURRENT_MAP, 'ldrb r4,[r3,r1]', 'mov r4,r1', 'Grid Style list: item k is value k (is current)');
  const lookup = (at: number, id: number) => {
    const stub = p.code(`cmp r1,#2;movweq r0,#${id};bxeq lr;cmp r1,#0;b #${at + 4};`);
    p.patch(at, one('cmp r1,#0', at), branchWord(at, stub), 'Grid Style: Golden Ratio\'s name and icon');
  };
  lookup(VALUE_TEXT, ids.text);
  lookup(VALUE_ICON, ids.icon);
  same(TYPE_CHECK_A, 'cmp r0,#1', 'cmp r0,#2', 'live view: grid types 0..2');
  same(TYPE_CHECK_A + 4, 'beq #0x531776c4', 'bls #0x531776c4', 'live view: grid types 0..2');
  same(TYPE_CHECK_B, 'cmp r0,#1', 'cmp r0,#2', 'live view: grid types 0..2');
  same(TYPE_CHECK_B + 4, 'bne #0x53178f5c', 'bhi #0x53178f5c', 'live view: grid types 0..2');
  // r4 = this, r5 = the canvas argument; r6..sl are the method's saved registers; [fp - 0x40] is its rectangle.
  const at = (f: number, start: string, end: string, out: string) =>
    `sub ip,${end},${start};movw r1,#${f};mul ip,ip,r1;add ip,ip,#0x8000;add ip,${start},ip,lsr #16;sub ${out},ip,#1;`;
  const line = (f: number, start: string, end: string, move: number) =>
    `${at(f, start, end, 'r1')}sub r0,fp,#0x40;bl #${move};mov r0,r4;mov r1,r5;sub r2,fp,#0x40;bl #${DRAW_RECT};`;
  const draw = p.code(`ldrb r3,[r0,#0xf4];cmp r3,#2;beq golden;b #${GRID_TYPE_NEXT};
    golden:add r7,r4,#0x30;
    mov r0,r7;bl #${RECT_X};mov r6,r0;mov r0,r7;bl #${RECT_Y};mov r8,r0;
    mov r0,r7;bl #${RECT_RIGHT};mov sb,r0;mov r0,r7;bl #${RECT_BOTTOM};mov sl,r0;
    add r3,r8,#1;str r3,[sp];sub r0,fp,#0x40;mov r1,r6;sub r2,r8,#1;mov r3,sb;bl #${RECT_NEW};
    ${line(GR3X_GOLDEN[0], 'r8', 'sl', RECT_MOVE_Y)}${line(GR3X_GOLDEN[1], 'r8', 'sl', RECT_MOVE_Y)}
    str sl,[sp];sub r0,fp,#0x40;sub r1,r6,#1;mov r2,r8;add r3,r6,#1;bl #${RECT_SET};
    ${line(GR3X_GOLDEN[0], 'r6', 'sb', RECT_MOVE_X)}${line(GR3X_GOLDEN[1], 'r6', 'sb', RECT_MOVE_X)}
    b #${GRID_DRAW_END};`);
  p.patch(GRID_TYPE_READ, one('ldrb r3,[r0,#0xf4]', GRID_TYPE_READ), branchWord(GRID_TYPE_READ, draw), 'grid: Golden Ratio lines (type 2)');
  return { goldenGridDraw: draw };
}

/** The 60 x 40 Golden Ratio icon, from the camera's 3x3 Grid icon (`div9`, RGBA): its two inner
 * lines each way moved to the golden sections of its frame (columns 5..54, rows 3..36). */
export function drawGr3xGoldenGridIcon(div9: Uint8Array): Uint8Array {
  const W = 60, H = 40;
  if (div9.length !== W * H * 4) fail('IIIx 3x3 Grid icon');
  const px = div9.slice();
  const get = (x: number, y: number) => px.slice((y * W + x) * 4, (y * W + x) * 4 + 4);
  const ink = get(5, 3), ground = get(8, 6);
  // The 3x3 icon: frame lines on columns 5-6 / 53-54 and rows 3-4 / 35-36, inner lines on 21-22, 37-38 and 14-15, 24-25.
  const isInk = (x: number, y: number) => get(x, y).every((v, i) => v === ink[i]);
  if (![5, 6, 21, 22, 37, 38, 53, 54].every(x => isInk(x, 10)) || ![3, 4, 14, 15, 24, 25, 35, 36].every(y => isInk(10, y)) || !isInk(5, 36) || !isInk(54, 3) || isInk(8, 6) || isInk(10, 37))
    fail('IIIx 3x3 Grid icon layout');
  for (let y = 5; y <= 34; y++) for (let x = 7; x <= 52; x++) px.set(ground, (y * W + x) * 4);
  // Columns 5 + round(49 f) - 1.. and rows 3 + round(33 f) - 1.., mirrored: 23-24 / 35-36 and 15-16 / 23-24.
  const cols = [23, 24, 35, 36], rows = [15, 16, 23, 24];
  for (let y = 5; y <= 34; y++) for (const x of cols) px.set(ink, (y * W + x) * 4);
  for (const y of rows) for (let x = 7; x <= 52; x++) px.set(ink, (y * W + x) * 4);
  return px;
}
