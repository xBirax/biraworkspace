import { deflateSync } from "node:zlib";

const SIZE = 16;
const DIGITS: Record<string, readonly string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "001", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  "+": ["000", "010", "111", "010", "000"],
};
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksumInput = Buffer.concat([typeBytes, data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(checksumInput));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function drawPixel(bitmap: Buffer, x: number, y: number, color: readonly number[]): void {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const offset = (y * SIZE + x) * 4;
  bitmap.set(color, offset);
}

function renderBadge(text: string): Buffer {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const distance = Math.hypot(x - 7.5, y - 7.5);
      if (distance <= 7) drawPixel(pixels, x, y, [255, 255, 255, 255]);
      if (distance <= 5.9) drawPixel(pixels, x, y, [220, 38, 38, 255]);
    }
  }

  const glyphWidth = text.length * 3 + (text.length - 1);
  const startX = Math.floor((SIZE - glyphWidth) / 2);
  const startY = 5;
  for (let index = 0; index < text.length; index++) {
    const glyph = DIGITS[text.charAt(index)]!;
    for (let row = 0; row < glyph.length; row++) {
      const glyphRow = glyph[row]!;
      for (let column = 0; column < glyphRow.length; column++) {
        if (glyphRow[column] === "1") {
          drawPixel(pixels, startX + index * 4 + column, startY + row, [255, 255, 255, 255]);
        }
      }
    }
  }

  const scanlines = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let row = 0; row < SIZE; row++) {
    const offset = row * (SIZE * 4 + 1);
    scanlines[offset] = 0;
    pixels.copy(scanlines, offset + 1, row * SIZE * 4, (row + 1) * SIZE * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function createTaskbarBadgePng(count: number): Buffer | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const unread = Math.floor(count);
  return renderBadge(unread > 99 ? "99+" : String(unread));
}

export function describeTaskbarBadge(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "Sem mensagens não lidas";
  const unread = Math.floor(count);
  return `${unread > 99 ? "99+" : unread} ${unread === 1 ? "mensagem não lida" : "mensagens não lidas"}`;
}
