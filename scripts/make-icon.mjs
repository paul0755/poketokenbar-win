/**
 * 앱 아이콘(256x256 PNG)을 그린다.
 *
 * 외부 이미지 라이브러리를 넣지 않는다. 아이콘 하나 만들자고
 * 의존성을 늘릴 이유가 없고, PNG 인코딩은 zlib(내장)만 있으면 된다.
 * PokéAPI의 몬스터볼 스프라이트는 30px이라 아이콘으로 쓰면 뭉개진다.
 *
 *   node scripts/make-icon.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const S = 256;

/* ---------------- PNG 인코딩 ---------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** rgba: Uint8Array(S*S*4) → PNG 버퍼 */
function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // 10,11,12 = compression/filter/interlace = 0

  // 각 줄 앞에 필터 바이트(0)를 붙인다
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy
      ? rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
      : Buffer.from(rgba.subarray(y * size * 4, (y + 1) * size * 4)).copy(
          raw,
          y * (size * 4 + 1) + 1,
        );
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------- 그리기 ---------------- */

const px = Buffer.alloc(S * S * 4);
const set = (x, y, [r, g, b, a]) => {
  const i = (y * S + x) * 4;
  // 위에 덮어 그릴 때 알파 합성
  const na = a / 255;
  px[i] = Math.round(px[i] * (1 - na) + r * na);
  px[i + 1] = Math.round(px[i + 1] * (1 - na) + g * na);
  px[i + 2] = Math.round(px[i + 2] * (1 - na) + b * na);
  px[i + 3] = Math.max(px[i + 3], a);
};

const RED = [237, 66, 69, 255];
const WHITE = [246, 247, 249, 255];
const BLACK = [26, 27, 31, 255];

const c = (S - 1) / 2;
const R = S * 0.46; // 공 반지름
const BAND = S * 0.075; // 가운데 띠 두께
const RING = S * 0.155; // 가운데 원 바깥 반지름
const CORE = S * 0.085; // 가운데 원 안쪽

/** 경계를 부드럽게 — 4x4 슈퍼샘플링 */
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let hit = 0;
    const acc = [0, 0, 0];
    for (let sy = 0; sy < 4; sy++) {
      for (let sx = 0; sx < 4; sx++) {
        const fx = x + (sx + 0.5) / 4 - c;
        const fy = y + (sy + 0.5) / 4 - c;
        const d = Math.hypot(fx, fy);
        if (d > R) continue;

        let col;
        if (d <= CORE) col = WHITE;
        else if (d <= RING) col = BLACK;
        else if (Math.abs(fy) <= BAND / 2) col = BLACK;
        else if (d > R - S * 0.035) col = BLACK; // 바깥 테두리
        else col = fy < 0 ? RED : WHITE;

        acc[0] += col[0];
        acc[1] += col[1];
        acc[2] += col[2];
        hit++;
      }
    }
    if (!hit) continue;
    const a = Math.round((hit / 16) * 255);
    set(x, y, [Math.round(acc[0] / hit), Math.round(acc[1] / hit), Math.round(acc[2] / hit), a]);
  }
}

const out = path.join(process.cwd(), "assets", "icon.png");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePng(px, S));
console.log(`✅ ${S}x${S} 아이콘 → ${path.relative(process.cwd(), out)} (${fs.statSync(out).size} bytes)`);
