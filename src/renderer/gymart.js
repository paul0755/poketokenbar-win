"use strict";
/**
 * 체육관 그림 — 관장 도트 캐릭터와 배지. 그림 파일 없이 코드로 그린다(egg.js · ballart.js 처럼).
 *
 * 관장은 이 앱에서 지은 인물이라 그림도 여기서 처음 그린다. 머리가 큰 2등신 도트(24×34칸)에
 * 테두리를 두르는 꼴이다. 몸 틀은 하나이고, 관장마다 뒷머리 · 앞머리 · 옷 · 소품만 덧칠한다.
 * 테두리와 그늘(오른쪽)은 칠한 칸을 보고 저절로 넣는다 — 손으로 칸을 다 찍지 않아도 같은 결이 나온다.
 *
 *   window.ptbGymArt.portrait(id, size)        관장(id 는 gyms.json 의 id)
 *   window.ptbGymArt.badge(id, got, size)      배지. got 이 false 면 회색 자리만
 */
(function () {
  let uid = 0;

  /** 타입 색 — [밝은, 어두운] */
  const TYPE = {
    grass: ["#9be36b", "#3f8f2a"],
    water: ["#8fb8ff", "#2d5fc4"],
    fire: ["#ffb067", "#c9531a"],
    electric: ["#ffe36b", "#c99a00"],
    psychic: ["#ff9ec0", "#b8336a"],
    ghost: ["#b39ddb", "#4a3570"],
    rock: ["#e3c58f", "#8a6430"],
    dragon: ["#a98bff", "#3b1fb0"],
    champ: ["#ffe08a", "#b07a12"], // 챔피언 로드 — 금빛
  };

  /* ---------------- 도트 ---------------- */

  const W = 24;
  const H = 34;
  const OUT = "#231a2b";

  /** 색을 어둡게 — 오른쪽 그늘 */
  function shade(hex, k = 0.2) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.round(v * (1 - k)));
    return "#" + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  /** 붓 — y 는 머리 위 장식 자리로 2칸 내려 찍는다 */
  function canvas() {
    const g = Array.from({ length: H }, () => Array(W).fill(null));
    const set = (x, y, k) => {
      y += 2;
      if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = k;
    };
    const rect = (x0, y0, x1, y1, k) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, k);
    };
    const dots = (k, pts) => pts.forEach(([x, y]) => set(x, y, k));
    return { g, set, rect, dots };
  }

  /** 얼굴 폭 — 6~18줄. 위아래 끝은 둥글게 */
  const HEAD = { 6: 4, 7: 5, 17: 5, 18: 4 };
  const headW = (y) => HEAD[y] ?? 6;

  /** 몸 틀 — 다리 · 신발 · 몸통 · 팔 · 목 · 얼굴 · 눈 */
  function base(p, L) {
    p.rect(8, 27, 10, 29, "d");
    p.rect(13, 27, 15, 29, "d");
    p.rect(7, 30, 10, 31, "b");
    p.rect(13, 30, 16, 31, "b");
    p.rect(7, 20, 16, 26, "c");
    p.rect(5, 20, 6, 23, "c");
    p.rect(17, 20, 18, 23, "c");
    p.rect(5, 24, 6, 25, "s");
    p.rect(17, 24, 18, 25, "s");
    p.rect(10, 19, 13, 19, "s");
    for (let y = 6; y <= 18; y++) p.rect(12 - headW(y), y, 11 + headW(y), y, "s");
    face(p, L);
  }

  function face(p) {
    // 눈 — 위는 까맣게, 아래는 눈동자 색, 왼쪽 위에 반짝
    p.dots("k", [[8, 12], [9, 12], [9, 13], [14, 12], [15, 12], [15, 13]]);
    p.dots("e", [[8, 13], [14, 13]]);
    p.dots("w", [[8, 12], [14, 12]]);
    p.dots("p", [[7, 15], [16, 15]]);
    p.dots("m", [[11, 16], [12, 16]]);
  }

  /** 머리 덮개 — 3~8줄. 앞머리는 관장마다 */
  function cap(p, k = "h") {
    p.rect(8, 3, 15, 3, k);
    p.rect(6, 4, 17, 4, k);
    p.rect(5, 5, 18, 8, k);
  }

  /*
   * 관장 여덟 명 — 색(pal)과 덧칠(back: 몸 뒤, front: 얼굴 위).
   * 색 이름: s 피부 · h 머리 · c 옷 · d 바지 · b 신발 · t 장식 · a/A 소품 · e 눈동자 · g 빛
   */
  const SKIN = { light: "#f7d9bd", warm: "#efc29b", tan: "#d29a6c", pale: "#ece4f2" };
  const LEADER = {
    // 새봄 — 온실 정원사. 단발 위로 새싹 하나, 흰 셔츠에 초록 앞치마
    sprout: {
      type: "grass",
      pal: { s: SKIN.light, h: "#8a5530", c: "#f3efe2", d: "#4f7d3a", b: "#7a4a2a", t: "#5fb04a", a: "#7ed957", A: "#ff9cc2", e: "#3f8f2a" },
      back(p) { p.rect(4, 8, 19, 17, "h"); },
      front(p) {
        cap(p);
        p.rect(5, 9, 18, 9, "h");
        p.dots("h", [[5, 10], [6, 10], [9, 10], [10, 10], [13, 10], [14, 10], [17, 10], [18, 10]]);
        p.dots("a", [[11, 2], [12, 1], [13, 1], [13, 0], [12, 2], [10, 1], [9, 1], [10, 0]]);
        p.dots("A", [[16, 7], [17, 6], [17, 8], [18, 7]]);
        p.rect(8, 21, 15, 26, "t");
        p.dots("t", [[8, 20], [15, 20]]);
        p.dots("c", [[11, 21], [12, 21]]);
        p.rect(10, 23, 13, 24, "a");
      },
    },
    // 윤슬 — 새벽 서퍼. 높이 묶은 머리, 이마에 고글, 줄무늬 잠수복
    wave: {
      type: "water",
      pal: { s: SKIN.warm, h: "#1d3f6e", c: "#2f6fd0", d: "#2a5fb3", b: "#f2e3c2", t: "#7fe0ff", a: "#9ff0ff", A: "#2b2b38", e: "#2d5fc4" },
      back(p) { p.rect(17, 3, 20, 5, "h"); p.rect(19, 5, 21, 14, "h"); p.rect(20, 14, 21, 16, "h"); },
      front(p) {
        cap(p);
        p.rect(5, 9, 18, 9, "h");
        p.rect(5, 10, 9, 10, "h");
        p.rect(5, 11, 6, 13, "h");
        p.rect(5, 7, 18, 7, "A");
        p.rect(7, 6, 10, 8, "a");
        p.rect(13, 6, 16, 8, "a");
        p.dots("A", [[11, 7], [12, 7]]);
        p.rect(7, 22, 16, 22, "t");
        p.rect(5, 22, 6, 22, "t");
        p.rect(17, 22, 18, 22, "t");
        p.dots("t", [[8, 28], [14, 28]]);
      },
    },
    // 화담 — 대장장이. 삐죽머리에 빨간 머리띠, 가죽 앞치마, 손에 망치
    ember: {
      type: "fire",
      pal: { s: SKIN.tan, h: "#2b1b14", c: "#e07a2e", d: "#4a3a32", b: "#231a1a", t: "#d8352a", a: "#8a8f99", A: "#7a4a24", e: "#c9531a" },
      back() {},
      front(p) {
        cap(p);
        p.dots("h", [[6, 3], [7, 2], [9, 2], [10, 1], [11, 2], [13, 1], [14, 2], [16, 2], [17, 3], [12, 2]]);
        p.rect(5, 9, 18, 9, "t");
        p.dots("t", [[19, 9], [20, 10], [20, 11]]);
        p.dots("h", [[5, 10], [6, 10], [17, 10], [18, 10]]);
        p.rect(5, 21, 6, 23, "s");
        p.rect(17, 21, 18, 23, "s");
        p.rect(8, 21, 15, 27, "A");
        p.dots("A", [[9, 20], [14, 20]]);
        p.rect(19, 22, 19, 29, "A");
        p.rect(18, 19, 21, 21, "a");
      },
    },
    // 한빛 — 발전소 엔지니어. 뻗친 노란 머리, 헤드셋, 번개 무늬 작업복
    spark: {
      type: "electric",
      pal: { s: SKIN.light, h: "#f2c21b", c: "#f09a1a", d: "#e08a12", b: "#3a3a44", t: "#fff27a", a: "#2b2b38", A: "#57d0ff", e: "#c99a00" },
      back() {},
      front(p) {
        cap(p);
        p.dots("h", [[5, 4], [6, 2], [7, 3], [9, 1], [10, 2], [13, 2], [14, 1], [16, 3], [17, 2], [18, 4]]);
        p.rect(5, 9, 18, 9, "h");
        p.dots("h", [[5, 10], [7, 10], [8, 10], [11, 10], [12, 10], [15, 10], [16, 10], [18, 10]]);
        p.rect(7, 4, 16, 4, "a");
        p.rect(4, 10, 5, 14, "a");
        p.rect(18, 10, 19, 14, "a");
        p.dots("a", [[6, 15], [7, 16], [8, 16]]);
        p.dots("A", [[9, 16]]);
        p.dots("t", [[12, 21], [13, 21], [11, 22], [12, 22], [11, 23], [12, 23], [10, 24]]);
        p.rect(7, 25, 16, 25, "a");
      },
    },
    // 은유 — 점술가. 긴 보랏빛 머리, 이마에 금 장식, 금테 두른 긴 옷, 품에 수정구슬
    omen: {
      type: "psychic",
      pal: { s: SKIN.light, h: "#6a3ea6", c: "#3e2470", d: "#3e2470", b: "#3e2470", t: "#f1c75a", a: "#ff9ed2", A: "#ffd7f0", e: "#b8336a" },
      back(p) { p.rect(4, 7, 19, 25, "h"); },
      front(p) {
        cap(p);
        p.rect(5, 9, 18, 9, "h");
        p.dots("h", [[5, 10], [6, 10], [7, 10], [16, 10], [17, 10], [18, 10], [5, 11], [18, 11]]);
        p.rect(6, 8, 17, 8, "t");
        p.dots("a", [[11, 8], [12, 8]]);
        p.rect(6, 20, 17, 31, "c");
        p.rect(4, 20, 6, 25, "c");
        p.rect(17, 20, 19, 25, "c");
        p.rect(6, 31, 17, 31, "t");
        p.rect(10, 20, 13, 20, "t");
        p.dots("s", [[8, 25], [15, 25]]);
        p.rect(9, 23, 14, 27, "a");
        p.dots("A", [[10, 24], [11, 24], [10, 25]]);
      },
    },
    // 그믐 — 등불지기. 짙은 두건 망토, 한쪽 눈을 가린 은빛 앞머리, 손에 든 등불
    lantern: {
      type: "ghost",
      pal: { s: SKIN.pale, h: "#3a2f5e", c: "#2e2550", d: "#2e2550", b: "#2e2550", t: "#b9a6ff", a: "#c9c3dc", A: "#5a4a2a", g: "#ffe9a8", e: "#7a5cc4" },
      back(p) { p.rect(4, 5, 19, 26, "h"); },
      front(p) {
        cap(p);
        p.rect(4, 8, 5, 19, "h");
        p.rect(18, 8, 19, 19, "h");
        p.rect(6, 9, 17, 9, "a");
        p.rect(12, 10, 17, 13, "a");
        p.dots("a", [[6, 10], [7, 10], [16, 14], [17, 14]]);
        p.rect(6, 20, 17, 31, "c");
        p.rect(4, 20, 6, 24, "c");
        p.rect(17, 20, 19, 24, "c");
        p.rect(11, 20, 12, 31, "t");
        p.rect(6, 31, 17, 31, "t");
        p.dots("A", [[4, 25], [4, 26]]);
        p.rect(2, 27, 6, 30, "A");
        p.rect(3, 28, 5, 29, "g");
      },
    },
    // 돌담 — 광산 반장. 등이 달린 노란 안전모, 희끗한 수염, 조끼, 어깨에 곡괭이
    bedrock: {
      type: "rock",
      pal: { s: SKIN.tan, h: "#b9b4ad", c: "#cdb27c", d: "#5b4a3c", b: "#2e2622", t: "#f2c21b", a: "#8a8f99", A: "#7a5230", e: "#5b4a3c" },
      back() {},
      front(p) {
        cap(p, "t");
        p.rect(4, 8, 19, 8, "t");
        p.rect(11, 4, 12, 6, "w");
        p.dots("h", [[5, 9], [5, 10], [5, 11], [18, 9], [18, 10], [18, 11]]);
        p.rect(7, 10, 10, 10, "h");
        p.rect(13, 10, 16, 10, "h");
        p.rect(7, 15, 16, 19, "h");
        p.rect(9, 15, 14, 15, "h");
        p.dots("s", [[7, 15], [16, 15]]);
        p.rect(7, 20, 9, 26, "A");
        p.rect(14, 20, 16, 26, "A");
        p.dots("A", [[19, 25], [19, 24], [20, 23], [20, 22], [20, 21], [21, 20], [21, 19]]);
        p.dots("a", [[19, 17], [20, 17], [21, 17], [22, 18], [23, 19], [18, 18]]);
      },
    },
    // 하람 — 용 사육사. 붉은 긴 머리에 금빛 뿔 장식, 금테 남색 코트, 붉은 망토
    scale: {
      type: "dragon",
      pal: { s: SKIN.warm, h: "#b3202e", c: "#26357e", d: "#1c2558", b: "#1a1a24", t: "#e5bf4f", a: "#a98bff", A: "#8a1424", e: "#6f35fc" },
      back(p) { p.rect(3, 20, 20, 31, "A"); p.rect(4, 7, 19, 22, "h"); },
      front(p) {
        cap(p);
        p.rect(5, 9, 18, 9, "h");
        p.dots("h", [[5, 10], [6, 10], [8, 10], [9, 10], [14, 10], [15, 10], [17, 10], [18, 10], [5, 11], [18, 11]]);
        p.dots("t", [[6, 4], [5, 3], [5, 2], [4, 1], [17, 4], [18, 3], [18, 2], [19, 1]]);
        p.rect(9, 20, 14, 20, "t");
        p.rect(11, 21, 12, 26, "t");
        p.dots("a", [[11, 22], [12, 22]]);
      },
    },
  };

  /*
   * 챔피언 누리 — 은빛 긴 머리를 낮게 묶고 이마에 금빛 서클릿, 흰 코트에 금 단추와 테두리,
   * 등 뒤로 펄럭이는 짙은 남색 망토, 목에 붉은 스카프. 관장들과 같은 몸 틀에 덧칠한다.
   */
  LEADER.champ = {
    type: "champ",
    pal: { s: SKIN.light, h: "#dfe3ee", c: "#f6f4ee", d: "#2b3156", b: "#1c1f33", t: "#e5bf4f", a: "#c8303c", A: "#232a5c", e: "#3b5bd6" },
    back(p) {
      p.rect(2, 20, 21, 31, "A");
      p.rect(4, 7, 19, 18, "h");
      p.rect(18, 15, 20, 24, "h");
    },
    front(p) {
      cap(p);
      p.rect(5, 9, 18, 9, "h");
      p.dots("h", [[5, 10], [6, 10], [7, 10], [10, 10], [11, 10], [16, 10], [17, 10], [18, 10], [5, 11], [18, 11], [5, 12]]);
      p.rect(6, 7, 17, 7, "t");
      p.dots("g", [[11, 6], [12, 6]]);
      p.dots("a", [[11, 7], [12, 7]]);
      p.rect(9, 19, 14, 20, "a");
      p.dots("a", [[14, 21], [15, 22]]);
      p.rect(11, 21, 12, 26, "t");
      p.dots("d", [[11, 22], [12, 24]]);
      p.rect(7, 26, 16, 26, "t");
      p.dots("t", [[5, 23], [18, 23]]);
    },
  };

  /** 칠한 칸 → 테두리 · 그늘을 넣어 SVG 사각형으로 */
  function pixels(L) {
    const p = canvas();
    L.back(p);
    base(p, L);
    L.front(p);
    const pal = { k: "#1f1830", w: "#ffffff", p: "#ff9aa8", m: "#a8454f", e: "#3a3a5a", ...L.pal };
    const g = p.g;
    const out = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = g[y][x];
        if (k) {
          // 빛은 왼쪽 위에서 — 오른쪽 넷째 칸부터 한 단 어둡게
          const right = x >= 15 && "shcdbA".includes(k);
          out.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${right ? shade(pal[k] || "#f0f") : pal[k] || "#f0f"}"/>`);
        } else if ((g[y - 1] && g[y - 1][x]) || (g[y + 1] && g[y + 1][x]) || g[y][x - 1] || g[y][x + 1]) {
          out.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${OUT}"/>`);
        }
      }
    }
    return out.join("");
  }

  const cache = {};
  function portrait(id, size = 96) {
    const L = LEADER[id];
    if (!L) return "";
    const t = TYPE[L.type];
    const g = "gp" + ++uid;
    const px = cache[id] || (cache[id] = pixels(L));
    return `<svg viewBox="-6 -1 36 36" width="${size}" height="${size}" aria-hidden="true">
      <defs><radialGradient id="${g}" cx="50%" cy="40%" r="65%"><stop offset="0" stop-color="${t[0]}"/><stop offset="1" stop-color="${t[1]}"/></radialGradient></defs>
      <circle cx="12" cy="17" r="18" fill="url(#${g})"/>
      <ellipse cx="12" cy="33.2" rx="9" ry="1.6" fill="#000" opacity=".25"/>
      <g shape-rendering="crispEdges">${px}</g>
    </svg>`;
  }

  /* ---------------- 배지 ---------------- */

  /** 배지 모양 여덟 — 잎 · 물방울 · 불꽃 · 번개 · 눈 · 등불 · 돌 · 비늘 */
  const SHAPE = {
    sprout: { d: "M20 4 C33 10 35 27 20 36 C5 27 7 10 20 4 Z", inner: `<path d="M20 9 V32 M20 18 L27 13 M20 25 L13 20" stroke="#fff" stroke-opacity=".6" stroke-width="1.6" fill="none"/>` },
    wave: { d: "M20 4 C28 16 32 21 32 27 A12 11 0 0 1 8 27 C8 21 12 16 20 4 Z", inner: `<path d="M12 28 C15 25 18 31 21 28 C24 25 27 31 30 28" stroke="#fff" stroke-opacity=".7" stroke-width="1.8" fill="none"/>` },
    ember: { d: "M20 3 C26 12 32 16 30 26 C29 33 24 37 20 37 C14 37 9 32 10 25 C11 19 16 18 15 11 C19 14 21 18 20 22 C24 18 23 10 20 3 Z", inner: `<path d="M20 26 C23 29 23 33 20 34 C17 33 17 29 20 26 Z" fill="#fff" fill-opacity=".6"/>` },
    spark: { d: "M24 3 L9 22 H19 L15 37 L31 16 H21 Z", inner: "" },
    omen: { d: "M3 20 C10 8 30 8 37 20 C30 32 10 32 3 20 Z", inner: `<circle cx="20" cy="20" r="6" fill="#fff" fill-opacity=".75"/><circle cx="20" cy="20" r="2.6" fill="#000" fill-opacity=".45"/>` },
    lantern: { d: "M20 3 L34 20 L20 37 L6 20 Z", inner: `<path d="M20 13 C24 18 24 24 20 27 C16 24 16 18 20 13 Z" fill="#fff" fill-opacity=".7"/>` },
    bedrock: { d: "M20 3 L35 11.5 V28.5 L20 37 L5 28.5 V11.5 Z", inner: `<path d="M20 3 V20 L35 28.5 M20 20 L5 28.5" stroke="#fff" stroke-opacity=".45" stroke-width="1.4" fill="none"/>` },
    scale: { d: "M20 3 C30 8 35 18 33 28 C30 35 25 37 20 37 C15 37 10 35 7 28 C5 18 10 8 20 3 Z", inner: `<path d="M11 16 L20 22 L29 16 M12 24 L20 30 L28 24" stroke="#fff" stroke-opacity=".6" stroke-width="1.8" fill="none"/>` },
    // 챔피언 로드 — 트로피(손잡이 달린 잔 · 받침)
    champ: { d: "M10 4 H30 V8 H36 C36 16 32 19 28 20 C27 24 24 26 22 27 V31 H27 V37 H13 V31 H18 V27 C16 26 13 24 12 20 C8 19 4 16 4 8 H10 Z M10 11 H7.5 C8 14 9.5 15.5 10.6 16 Z M30 11 V16 C31.5 15.5 32 14 32.5 11 Z", inner: `<path d="M20 9 L21.8 13 L26 13.4 L22.8 16.2 L23.8 20.4 L20 18.2 L16.2 20.4 L17.2 16.2 L14 13.4 L18.2 13 Z" fill="#fff" fill-opacity=".7"/>` },
  };

  function badge(id, got = true, size = 34) {
    const s = SHAPE[id];
    const L = LEADER[id];
    if (!s || !L) return "";
    if (!got) {
      return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true"><path d="${s.d}" fill="rgba(140,150,170,.16)" stroke="rgba(160,170,190,.45)" stroke-width="1.4" stroke-dasharray="3 2.5"/></svg>`;
    }
    /*
     * 입체 — 금속판 하나를 겹으로 쌓는다.
     *   ① 아래로 밀린 짙은 판(두께)  ② 바깥 테(왼쪽 위가 밝은 금속)  ③ 안쪽 면(반대로 비춰 움푹)
     *   ④ 왼쪽 위 반사광  ⑤ 무늬는 살짝 파인 것처럼(어두운 그림자 + 밝은 선)
     */
    const t = TYPE[L.type];
    const g = "gb" + ++uid;
    const inset = (k) => `transform="translate(20 20) scale(${k}) translate(-20 -20)"`;
    const dark = shade(t[1], 0.45);
    return `<svg viewBox="-1 -1 42 44" width="${size}" height="${size}" aria-hidden="true">
      <defs>
        <linearGradient id="${g}r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".22" stop-color="${t[0]}"/><stop offset=".62" stop-color="${t[1]}"/><stop offset=".85" stop-color="${dark}"/><stop offset="1" stop-color="${t[1]}"/></linearGradient>
        <linearGradient id="${g}f" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${t[0]}"/><stop offset=".55" stop-color="${t[1]}"/><stop offset="1" stop-color="${dark}"/></linearGradient>
        <radialGradient id="${g}h" cx="32%" cy="24%" r="40%"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".5" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
        <clipPath id="${g}c"><path d="${s.d}"/></clipPath>
      </defs>
      <ellipse cx="20" cy="40" rx="11" ry="1.8" fill="#000" opacity=".3"/>
      <path d="${s.d}" transform="translate(0 2.2)" fill="${dark}" stroke="${dark}" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="${s.d}" fill="url(#${g}r)" stroke="${dark}" stroke-width="1" stroke-linejoin="round"/>
      <path d="${s.d}" ${inset(0.74)} fill="url(#${g}f)"/>
      <path d="${s.d}" ${inset(0.74)} fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.2" stroke-linejoin="round"/>
      <g ${inset(0.74)}>
        <g transform="translate(0 .8)" opacity=".5" style="filter:brightness(0)">${s.inner}</g>
        ${s.inner}
      </g>
      <g clip-path="url(#${g}c)"><ellipse cx="13" cy="11" rx="13" ry="9" fill="url(#${g}h)"/></g>
    </svg>`;
  }

  window.ptbGymArt = { portrait, badge, TYPE, LEADER };
})();
