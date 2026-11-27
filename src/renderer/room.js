"use strict";
/**
 * 미니룸 탭 — 내 방을 그리고 꾸민다. 무엇을 가졌는지는 메인(main/room.js)이 정한다.
 *
 * ── 그림 ──
 * 방 전체를 320×200 픽셀 캔버스에 칠하고 그대로 확대한다(image-rendering: pixelated).
 * 포켓몬 스프라이트가 도트라 가구도 도트여야 한 방에 있는 것처럼 보인다. 원작 그림은
 * 쓰지 않는다 — 전부 여기서 사각형을 찍어 그린다.
 *
 *   바닥 캔버스   벽지 · 바닥 · 창문 · 벽 장식 · 러그 (납작한 것)
 *   가구 캔버스   바닥에 서는 가구는 하나씩 따로. 아랫변 높이로 앞뒤(z)를 정해서
 *                포켓몬이 화분 뒤로 지나가고 침대 앞을 걷는다
 *   글자          도감 수·승수·졸업생 이름은 HTML 로 얹는다(캔버스 글씨는 뭉개진다)
 *
 * ── 포켓몬 ──
 * 아이마다 작은 상태 기계가 돈다 — 서성이기 · 걷기 · 열매 먹기(화분) · 쿠션에 앉기 ·
 * 자기(밤이면 침대) · TV 보기 · 마주치면 하트. 누르면 깡충 뛴다.
 * 코인 가구 앞에서는 — 빈백 낮잠 · 주크박스 춤 · 게임기(둘이 양옆) · 벽난로 쬐기(불 타입이 잘 온다) ·
 * 연못 첨벙(물 타입이 잘 온다) · 회복기 · 석상과 마스터볼 구경.
 * 방 탭이 안 보이는 동안은 멈춘다.
 *
 * 30초마다 갱신이 오지만 방 그림은 바뀐 게 있을 때만 다시 칠하고, 걷던 아이들은 그대로 둔다.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const AW = 320; // 그림 좌표(픽셀)
  const AH = 200;
  const FLOOR = 124; // 벽과 바닥의 경계
  let last = null; // 마지막 갱신 — 꾸미기 패널이 쓴다

  /* ================= 그리기 도구 ================= */

  function canvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    return [c, g];
  }
  const R = (g, x, y, w, h, c) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  /** 테두리 1px + 왼쪽 위 밝은 줄 + 오른쪽 아래 어두운 줄 — 도트 그림의 기본 입체감 */
  function box(g, x, y, w, h, fill, line, hi, lo) {
    R(g, x, y, w, h, line);
    R(g, x + 1, y + 1, w - 2, h - 2, fill);
    if (hi) { R(g, x + 1, y + 1, w - 2, 1, hi); R(g, x + 1, y + 1, 1, h - 2, hi); }
    if (lo) { R(g, x + 1, y + h - 2, w - 2, 1, lo); R(g, x + w - 2, y + 1, 1, h - 2, lo); }
  }
  /** 정수 타원 — 줄마다 폭을 계산해 찍는다 */
  function oval(g, cx, cy, rx, ry, c, top = -ry, bottom = ry) {
    g.fillStyle = c;
    for (let y = top; y <= bottom; y++) {
      const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
      g.fillRect(cx - w, cy + y, w * 2 + 1, 1);
    }
  }
  /** 바둑판 점묘 — 도트 그림에서 그러데이션 대신 쓴다 */
  function dither(g, x, y, w, h, c, phase = 0) {
    g.fillStyle = c;
    for (let j = 0; j < h; j++) for (let i = (j + phase) % 2; i < w; i += 2) g.fillRect(x + i, y + j, 1, 1);
  }
  /** 매번 같은 무늬가 나와야 해서 씨앗 있는 난수를 쓴다 */
  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ================= 시간 ================= */

  /** 창밖은 실제 시간을 따라간다. 밤하늘 배경은 언제나 밤 */
  function period(theme) {
    if (theme === "night") return "night";
    const h = new Date().getHours();
    if (h >= 6 && h < 17) return "day";
    if (h >= 17 && h < 20) return "evening";
    return "night";
  }

  /* ================= 벽지 · 바닥 ================= */

  const THEMES = {
    cabin: {
      wall(g) {
        R(g, 0, 0, AW, FLOOR, "#dcb682");
        for (let x = 0; x < AW; x += 14) { R(g, x, 0, 1, FLOOR, "#c29a63"); R(g, x + 1, 0, 1, FLOOR, "#e6c595"); }
        const r = seeded(7);
        for (let i = 0; i < 18; i++) { const x = Math.floor(r() * AW), y = Math.floor(r() * 100); R(g, x, y, 2, 1, "#b88c55"); R(g, x, y + 1, 1, 1, "#c79d66"); }
      },
      trim: ["#8a5a32", "#6b4424", "#a8743f"],
      floor(g) {
        R(g, 0, FLOOR, AW, AH - FLOOR, "#b27b47");
        for (let y = FLOOR, row = 0; y < AH; y += 8, row++) {
          R(g, 0, y, AW, 1, "#8f5f33");
          R(g, 0, y + 1, AW, 1, "#c08955");
          for (let x = (row % 2) * 26; x < AW; x += 52) R(g, x, y, 1, 8, "#8f5f33");
        }
      },
    },
    beach: {
      wall(g) {
        R(g, 0, 0, AW, FLOOR, "#e6f4f9");
        for (let y = 0; y < FLOOR; y += 12) R(g, 0, y, AW, 1, "#cbe5ee");
        for (let y = 0, r = 0; y < FLOOR; y += 12, r++) for (let x = (r % 2) * 12; x < AW; x += 24) R(g, x, y, 1, 12, "#cbe5ee");
        // 벽 아래쪽 물결 띠
        for (let x = 0; x < AW; x++) R(g, x, 96 + Math.round(Math.sin(x / 6) * 2), 1, 3, "#7cc6dc");
      },
      trim: ["#4fa8c0", "#357e93", "#7cc6dc"],
      floor(g) {
        R(g, 0, FLOOR, AW, AH - FLOOR, "#f0d8a2");
        const r = seeded(3);
        for (let i = 0; i < 420; i++) R(g, Math.floor(r() * AW), FLOOR + Math.floor(r() * (AH - FLOOR)), 1, 1, r() < 0.5 ? "#e2c27f" : "#f7e6bd");
        // 불가사리 · 조개
        const star = (x, y) => { R(g, x + 2, y, 1, 5, "#f08a5d"); R(g, x, y + 2, 5, 1, "#f08a5d"); R(g, x + 1, y + 1, 3, 3, "#f08a5d"); R(g, x + 2, y + 2, 1, 1, "#ffd0b5"); };
        star(70, 186); star(250, 140);
        oval(g, 120, 192, 3, 2, "#fbe3ef"); R(g, 118, 192, 5, 1, "#e9b8cf");
      },
    },
    night: {
      wall(g) {
        R(g, 0, 0, AW, FLOOR, "#262a5e");
        dither(g, 0, 0, AW, 40, "#20234f");
        const r = seeded(11);
        for (let i = 0; i < 70; i++) {
          const x = Math.floor(r() * AW), y = Math.floor(r() * 110);
          R(g, x, y, 1, 1, r() < 0.3 ? "#ffffff" : "#9aa3e8");
          if (r() < 0.12) { R(g, x - 1, y, 3, 1, "#c9cdf7"); R(g, x, y - 1, 1, 3, "#c9cdf7"); }
        }
      },
      trim: ["#15173a", "#0d0f26", "#2c3070"],
      floor(g) {
        R(g, 0, FLOOR, AW, AH - FLOOR, "#3d3264");
        for (let y = FLOOR + 4; y < AH; y += 10) for (let x = ((y / 10) % 2) * 10; x < AW; x += 20) {
          R(g, x + 4, y, 1, 1, "#54478a"); R(g, x + 3, y + 1, 3, 1, "#54478a"); R(g, x + 4, y + 2, 1, 1, "#54478a");
        }
      },
    },
    lab: {
      wall(g) {
        R(g, 0, 0, AW, FLOOR, "#eef1f4");
        for (let x = 0; x < AW; x += 40) { R(g, x, 0, 1, FLOOR, "#d3d9df"); R(g, x + 1, 0, 1, FLOOR, "#f8fafb"); }
        R(g, 0, 60, AW, 2, "#d3d9df");
        for (let x = 6; x < AW; x += 40) { R(g, x, 64, 2, 2, "#c3cbd3"); R(g, x + 30, 64, 2, 2, "#c3cbd3"); }
      },
      trim: ["#7d8a97", "#5c6772", "#a3aeb9"],
      floor(g) {
        for (let y = FLOOR, r = 0; y < AH; y += 10, r++) for (let x = 0, c = r % 2; x < AW; x += 10, c ^= 1) R(g, x, y, 10, 10, c ? "#dfe5ea" : "#f5f7f9");
      },
    },
    snow: {
      wall(g) {
        // 통나무를 눕혀 쌓은 벽
        for (let y = 0; y < FLOOR; y += 10) {
          R(g, 0, y, AW, 10, "#9c6f47");
          R(g, 0, y, AW, 2, "#b58658");
          R(g, 0, y + 8, AW, 2, "#7a5434");
          for (let x = (y / 10) % 2 ? 30 : 0; x < AW; x += 60) { R(g, x, y + 3, 3, 4, "#7a5434"); }
        }
      },
      trim: ["#6b4a2c", "#4e3520", "#8a6440"],
      floor(g) {
        R(g, 0, FLOOR, AW, AH - FLOOR, "#c8b393");
        for (let y = FLOOR; y < AH; y += 12) { R(g, 0, y, AW, 1, "#a99272"); R(g, 0, y + 1, AW, 1, "#d8c6a8"); }
        dither(g, 0, AH - 10, AW, 10, "#b9a283");
      },
    },
    cave: {
      wall(g) {
        R(g, 0, 0, AW, FLOOR, "#5d5866");
        const r = seeded(21);
        for (let i = 0; i < 60; i++) {
          const x = Math.floor(r() * AW), y = Math.floor(r() * FLOOR), w = 6 + Math.floor(r() * 14), h = 3 + Math.floor(r() * 6);
          R(g, x, y, w, h, r() < 0.5 ? "#6b6575" : "#514c5a");
          R(g, x, y, w, 1, "#77718a");
        }
        // 종유석
        for (let x = 4; x < AW; x += 22 + Math.floor(r() * 16)) {
          const len = 6 + Math.floor(r() * 14);
          for (let i = 0; i < len; i++) R(g, x + Math.floor(i / 4), i, Math.max(1, 6 - Math.floor(i / 3)), 1, i % 3 ? "#6f697b" : "#7d778c");
        }
        // 빛나는 수정
        const crystal = (x, y, c, hi) => { for (let i = 0; i < 8; i++) R(g, x + Math.floor(i / 3), y - i, 3, 1, i < 2 ? hi : c); R(g, x + 1, y - 6, 1, 4, hi); };
        crystal(150, 100, "#7fd8ff", "#d6f5ff"); crystal(158, 102, "#b48cff", "#e6d9ff"); crystal(300, 96, "#7fd8ff", "#d6f5ff");
      },
      trim: ["#45414d", "#34313b", "#5d5866"],
      floor(g) {
        R(g, 0, FLOOR, AW, AH - FLOOR, "#6e6a64");
        const r = seeded(5);
        for (let i = 0; i < 40; i++) {
          const x = Math.floor(r() * AW), y = FLOOR + 3 + Math.floor(r() * (AH - FLOOR - 6));
          oval(g, x, y, 6 + Math.floor(r() * 8), 2 + Math.floor(r() * 2), r() < 0.5 ? "#7a766f" : "#625e58");
        }
      },
    },

    /*
     * 🌿 디지털 초원 — 디지털 월드의 기본 맵. 파란 하늘 · 뭉게구름 · 멀리 뾰족한 산과 언덕 · 숲,
     * 하늘엔 데이터 큐브가 몇 개 떠 있다(여기가 디지털 월드라는 표시). 바닥은 풀밭과 흙길
     */
    digital: {
      wall(g) {
        const bands = ["#5fb4ee", "#78c3f2", "#93d1f5", "#b4e1f8"];
        bands.forEach((c, i) => { R(g, 0, i * 25, AW, 25, c); if (i) dither(g, 0, i * 25, AW, 2, bands[i - 1]); });
        R(g, 0, 100, AW, FLOOR - 100, "#c9ebfa");
        // 뭉게구름
        const cloud = (x, y, s) => {
          oval(g, x, y, 10 * s, 4 * s, "#ffffff"); oval(g, x - 7 * s, y + 2 * s, 7 * s, 3 * s, "#ffffff"); oval(g, x + 8 * s, y + 2 * s, 8 * s, 3 * s, "#ffffff");
          R(g, x - 13 * s, y + 4 * s, 28 * s, 1, "#d8eefa");
        };
        cloud(52, 22, 1); cloud(150, 12, 0.8); cloud(214, 36, 1.1);
        // 데이터 큐브 — 하늘에 떠 있는 작은 네모(디지털 월드의 표시)
        const cube = (x, y, sz) => { R(g, x, y, sz, sz, "#3dd6a0"); R(g, x, y, sz, 1, "#b8ffe6"); R(g, x, y, 1, sz, "#b8ffe6"); R(g, x + sz - 1, y + 1, 1, sz - 1, "#1a8f69"); R(g, x + 1, y + sz - 1, sz - 1, 1, "#1a8f69"); };
        cube(104, 30, 5); cube(266, 16, 4); cube(28, 52, 4); cube(186, 58, 3);
        // 해
        oval(g, 290, 32, 9, 9, "#fff3a8"); oval(g, 290, 32, 7, 7, "#ffe066"); R(g, 286, 28, 3, 2, "#fffbe0");
        // 멀리 뾰족한 산(가운데) — 꼭대기에 눈, 옆으로 이어진 먼 산
        for (let x = 0; x < AW; x++) {
          const far = Math.round(92 - Math.max(0, 14 - Math.abs(x - 40) * 0.35) - Math.max(0, 12 - Math.abs(x - 250) * 0.3) - Math.sin(x / 11) * 2);
          R(g, x, far, 1, FLOOR - far, "#8fb9d6");
        }
        for (let x = 110; x < 210; x++) {
          const top = Math.round(36 + Math.abs(x - 160) * 1.05);
          if (top > FLOOR) continue;
          R(g, x, top, 1, FLOOR - top, x < 160 ? "#6f8fb0" : "#5a7898");
          if (top < 52) R(g, x, top, 1, Math.min(6, 52 - top), "#f4f8fb"); // 눈
        }
        // 가까운 언덕과 숲
        for (let x = 0; x < AW; x++) {
          const hill = Math.round(104 - Math.sin(x / 26) * 6 - Math.sin(x / 9 + 1) * 2);
          R(g, x, hill, 1, FLOOR - hill, "#6fbf4f");
          R(g, x, hill, 1, 1, "#9be07a");
        }
        const r = seeded(51);
        for (let x = 2; x < AW; x += 7 + Math.floor(r() * 9)) {
          if (x > 128 && x < 192 && r() < 0.6) continue; // 산 앞은 비워 둔다
          const h = 10 + Math.floor(r() * 8), y = Math.round(104 - Math.sin(x / 26) * 6) - h + 4;
          for (let i = 0; i < h; i++) { const w = Math.max(1, Math.floor((i * 7) / h)); R(g, x - (w >> 1), y + i, w + 1, 1, i % 3 ? "#2f7d3a" : "#3c9447"); }
          R(g, x, y + h, 1, 2, "#5d4037");
        }
      },
      trim: ["#4f9a3a", "#3a7a2a", "#8fd96a"],
      floor(g) {
        R(g, 0, FLOOR, AW, AH - FLOOR, "#79c556");
        dither(g, 0, FLOOR, AW, AH - FLOOR, "#6db84c");
        // 흙길 — 왼쪽 앞에서 오른쪽 뒤로
        for (let y = FLOOR; y < AH; y++) {
          const t = (y - FLOOR) / (AH - FLOOR);
          const cx = Math.round(230 - t * 120 + Math.sin(t * 5) * 14), w = Math.round(10 + t * 30);
          R(g, cx - w, y, w * 2, 1, "#d9b98a");
          R(g, cx - w, y, 2, 1, "#b8956a"); R(g, cx + w - 2, y, 2, 1, "#b8956a");
        }
        // 풀 포기 · 꽃
        const r = seeded(19);
        for (let i = 0; i < 90; i++) {
          const x = Math.floor(r() * AW), y = FLOOR + 4 + Math.floor(r() * (AH - FLOOR - 6));
          R(g, x, y, 1, 2, "#4f9a3a"); R(g, x + 2, y - 1, 1, 3, "#4f9a3a"); R(g, x + 1, y + 1, 1, 1, "#3a7a2a");
        }
        for (let i = 0; i < 26; i++) {
          const x = Math.floor(r() * AW), y = FLOOR + 6 + Math.floor(r() * (AH - FLOOR - 8));
          const c = ["#ffffff", "#ffd54f", "#ff8fb1", "#b39ddb"][i % 4];
          R(g, x, y, 2, 2, c); R(g, x, y + 2, 1, 1, "#3a7a2a");
        }
      },
    },

    /* ---- 코인 배경 (deco.json) ---- */

    // 포켓몬센터 — 흰 벽 · 몬스터볼 무늬 빨간 띠 · 분홍 징두리 · 크림 타일
    pcenter: {
      wall(g) {
        R(g, 0, 0, AW, FLOOR, "#fff7f3");
        R(g, 0, 0, AW, 12, "#e53935"); R(g, 0, 12, AW, 2, "#b71c1c"); R(g, 0, 2, AW, 1, "#ef6b67");
        for (let x = 32; x < AW; x += 64) {
          oval(g, x, 6, 4, 4, "#ffffff", 0, 4); oval(g, x, 6, 4, 4, "#ffcdd2", -4, -1); R(g, x - 4, 6, 9, 1, "#7a1f1f"); R(g, x, 6, 1, 1, "#ffffff");
        }
        R(g, 0, 86, AW, FLOOR - 86, "#ffd9d3"); R(g, 0, 86, AW, 2, "#f2a29a"); R(g, 0, 88, AW, 1, "#ffe9e5");
        for (let x = 8; x < AW; x += 32) { R(g, x, 92, 1, 26, "#f6bcb4"); R(g, x + 1, 92, 1, 26, "#ffece8"); }
      },
      trim: ["#c62828", "#8e1b1b", "#ef5350"],
      floor(g) {
        for (let y = FLOOR, r = 0; y < AH; y += 12, r++) for (let x = 0, c = r % 2; x < AW; x += 16, c ^= 1) {
          R(g, x, y, 16, 12, c ? "#f9e6d6" : "#fff4ea"); R(g, x, y, 16, 1, "#ead2bf"); R(g, x, y, 1, 12, "#ead2bf");
        }
        R(g, 0, 176, AW, 6, "#ef5350"); R(g, 0, 176, AW, 1, "#ff8a80"); R(g, 0, 181, AW, 1, "#c62828");
      },
    },
    // 체육관 — 철판 벽 · 천장 조명 · 양옆 깃발 · 초록 배틀필드
    gym: {
      wall(g) {
        R(g, 0, 0, AW, FLOOR, "#22304f");
        for (let x = 0; x < AW; x += 40) {
          R(g, x, 0, 1, FLOOR, "#18223b"); R(g, x + 1, 0, 1, FLOOR, "#2e3f66");
          for (let y = 30; y < FLOOR; y += 30) { R(g, x + 4, y, 1, 1, "#4a5c87"); R(g, x + 35, y, 1, 1, "#4a5c87"); }
        }
        R(g, 0, 0, AW, 16, "#141c30"); R(g, 0, 16, AW, 1, "#3b4a6b");
        for (const x of [40, 120, 200, 280]) { R(g, x - 6, 4, 12, 6, "#555f75"); R(g, x - 5, 9, 10, 2, "#fff8d0"); dither(g, x - 10, 11, 20, 8, "#fff8d055"); }
        const flag = (x, c, d) => {
          R(g, x, 17, 14, 30, c); for (let i = 0; i < 5; i++) R(g, x + i, 47 + i, 14 - i * 2, 1, c);
          R(g, x, 17, 14, 2, d); oval(g, x + 7, 31, 3, 3, "#ffffff"); oval(g, x + 7, 31, 1, 1, c);
        };
        flag(2, "#d84343", "#9e2a2a"); flag(305, "#3d73d9", "#2a4f9e");
      },
      trim: ["#3b4a6b", "#26314b", "#55688f"],
      floor(g) {
        for (let y = FLOOR, i = 0; y < AH; y += 10, i++) R(g, 0, y, AW, 10, i % 2 ? "#5aa04a" : "#529643");
        const W = "#eef6e8";
        R(g, 6, FLOOR + 6, AW - 12, 1, W); R(g, 6, AH - 7, AW - 12, 1, W);
        R(g, 6, FLOOR + 6, 1, AH - FLOOR - 12, W); R(g, AW - 7, FLOOR + 6, 1, AH - FLOOR - 12, W);
        R(g, 160, FLOOR + 6, 1, AH - FLOOR - 12, W);
        for (let a = 0; a < 360; a += 0.5) { const r = (a * Math.PI) / 180; R(g, Math.round(160 + Math.cos(r) * 34), Math.round(162 + Math.sin(r) * 14), 1, 1, W); }
        oval(g, 160, 162, 5, 5, W); oval(g, 160, 162, 4, 4, "#e53935", -4, -1); oval(g, 160, 162, 4, 4, "#ffffff", 0, 4); R(g, 156, 162, 9, 1, "#333333");
      },
    },
    // 하늘기둥 — 우주 · 초록 오로라(레쿠쟈) · 양옆 낡은 돌기둥 · 이끼 낀 돌바닥과 빛나는 문양
    pillar: {
      wall(g) {
        const bands = ["#0b0620", "#120a33", "#1b0f47", "#24145a"];
        bands.forEach((c, i) => { R(g, 0, i * 31, AW, 31, c); if (i) dither(g, 0, i * 31, AW, 3, bands[i - 1]); });
        const r = seeded(31);
        for (let i = 0; i < 90; i++) {
          const x = Math.floor(r() * AW), y = Math.floor(r() * 118);
          R(g, x, y, 1, 1, r() < 0.3 ? "#ffffff" : "#a99cf0");
          if (r() < 0.08) { R(g, x - 1, y, 3, 1, "#d6cffb"); R(g, x, y - 1, 1, 3, "#d6cffb"); }
        }
        oval(g, 272, 30, 13, 13, "#7e6cc9"); oval(g, 270, 28, 12, 12, "#b9a8ff"); oval(g, 266, 25, 3, 2, "#9c88ef"); oval(g, 276, 33, 2, 2, "#9c88ef"); R(g, 264, 22, 3, 1, "#e4dcff");
        for (let x = 0; x < AW; x++) {
          const y = Math.round(70 + Math.sin(x / 22) * 10 + Math.sin(x / 9) * 2);
          R(g, x, y, 1, 5, "#2bb673"); R(g, x, y + 1, 1, 3, "#4ee39a"); R(g, x, y + 2, 1, 1, "#b8ffd9");
          if (x % 9 === 0) R(g, x, y + 5, 1, 2, "#e8c13a");
        }
        dither(g, 0, 66, AW, 22, "#4ee39a14");
        for (const x of [0, 302]) {
          R(g, x, 0, 18, FLOOR, "#857e6a"); R(g, x + 2, 0, 3, FLOOR, "#a29a83"); R(g, x + 14, 0, 3, FLOOR, "#655f4f");
          for (let y = 12; y < FLOOR; y += 22) R(g, x, y, 18, 1, "#655f4f");
          dither(g, x, 40, 18, 6, "#5b7a3f"); dither(g, x + 2, 98, 12, 5, "#5b7a3f", 1);
        }
      },
      trim: ["#6b6553", "#4a4537", "#8a8370"],
      floor(g) {
        R(g, 0, FLOOR, AW, AH - FLOOR, "#7d7766");
        const r = seeded(17);
        for (let y = FLOOR, row = 0; y < AH; y += 13, row++) {
          R(g, 0, y, AW, 1, "#5f5a4c");
          for (let x = (row % 2) * 14; x < AW; x += 28) {
            R(g, x, y, 1, 13, "#5f5a4c"); R(g, x + 1, y + 1, 26, 1, "#948d79");
            if (r() < 0.35) for (let i = 0; i <= 6; i++) R(g, x + 4 + i, y + 3 + i, 1, 1, "#655f4f"); // 금
          }
        }
        dither(g, 0, FLOOR, 60, 8, "#5b7a3f"); dither(g, 250, AH - 12, 70, 12, "#5b7a3f", 1);
        for (const [x, y] of [[96, 180], [224, 150]]) { oval(g, x, y, 8, 3, "#3fb6d9"); oval(g, x, y, 6, 2, "#7fe0ff"); R(g, x - 1, y - 1, 3, 3, "#e0fbff"); }
      },
    },
  };

  /* ================= 창밖 ================= */

  const SKY = {
    day: ["#6ec3f4", "#8fd2f7", "#b3e2fa", "#d4f0ff"],
    evening: ["#5b4b8a", "#c4688a", "#f59e6b", "#ffd59e"],
    night: ["#0e1433", "#151d45", "#1d2758", "#26316b"],
  };

  function sky(g, x, y, w, h, theme, per) {
    const c = SKY[per];
    const band = Math.ceil(h / c.length);
    c.forEach((col, i) => {
      R(g, x, y + i * band, w, Math.min(band, h - i * band), col);
      if (i) dither(g, x, y + i * band, w, 2, c[i - 1]);
    });
    if (per === "night") {
      const r = seeded(9);
      for (let i = 0; i < 16; i++) R(g, x + Math.floor(r() * w), y + Math.floor(r() * h * 0.7), 1, 1, "#ffffff");
      oval(g, x + w - 14, y + 9, 5, 5, "#fff6c9"); oval(g, x + w - 12, y + 8, 4, 4, c[0]); // 초승달
    } else {
      const sx = x + w - 14, sy = per === "day" ? y + 10 : y + h - 14;
      oval(g, sx, sy, 5, 5, per === "day" ? "#ffd54f" : "#ff9f43");
      R(g, sx - 2, sy - 2, 2, 2, per === "day" ? "#fff3b0" : "#ffd59e");
      if (per === "day") {
        oval(g, x + 14, y + 12, 7, 3, "#ffffff"); oval(g, x + 19, y + 10, 5, 3, "#ffffff"); R(g, x + 8, y + 14, 18, 1, "#e3f3ff");
      }
    }
    if (theme === "beach") {
      const sea = y + Math.floor(h * 0.62);
      R(g, x, sea, w, y + h - sea, per === "night" ? "#123a6b" : "#1e88e5");
      R(g, x, sea, w, 1, per === "night" ? "#3c6aa5" : "#90caf9");
      for (let i = 0; i < 5; i++) R(g, x + 4 + i * 11, sea + 4 + (i % 2) * 4, 5, 1, per === "night" ? "#2f5d93" : "#bbdefb");
    }
    if (theme === "snow") {
      const ground = y + Math.floor(h * 0.7);
      R(g, x, ground, w, y + h - ground, "#f4f8fb");
      R(g, x, ground, w, 1, "#ffffff");
      // 전나무
      for (let i = 0; i < 9; i++) R(g, x + 9 - Math.floor(i / 2), ground - 10 + i, 1 + Math.floor(i / 2) * 2, 1, "#2e6b4f");
      const r = seeded(13);
      for (let i = 0; i < 22; i++) R(g, x + Math.floor(r() * w), y + Math.floor(r() * (ground - y)), 1, 1, "#ffffff");
    }
    if (theme === "digital") {
      // 디지털 월드 — 창밖도 데이터 하늘(격자)
      R(g, x, y, w, h, "#0b2846");
      for (let i = 0; i < w; i += 6) R(g, x + i, y, 1, h, "#147a7466");
      for (let j = 0; j < h; j += 6) R(g, x, y + j, w, 1, "#147a7466");
    }
    if (theme === "cave") {
      // 동굴 밖 — 바위 틈으로 보이는 하늘
      dither(g, x, y, w, 4, "#3f3b47");
      dither(g, x, y + h - 4, w, 4, "#3f3b47", 1);
    }
  }

  /* ================= 벽 장식 ================= */

  function drawWindow(g, theme, per) {
    const x = 26, y = 24, w = 64, h = 50;
    box(g, x, y, w, h, "#7a4e2a", "#4e3018", "#9a6a3e");
    sky(g, x + 3, y + 3, w - 6, h - 6, theme, per);
    R(g, x + w / 2 - 1, y + 3, 2, h - 6, "#f1e7d6"); R(g, x + 3, y + h / 2 - 1, w - 6, 2, "#f1e7d6");
    // 커튼
    for (const cx of [x - 3, x + w - 5]) {
      R(g, cx, y - 3, 8, h + 4, "#d96a6a");
      for (let i = 1; i < 8; i += 3) R(g, cx + i, y - 3, 1, h + 4, "#b94f4f");
      R(g, cx, y + h + 1, 8, 1, "#a94444");
    }
    R(g, x - 6, y - 5, w + 12, 3, "#5e3a1d"); // 커튼 봉
    box(g, x - 4, y + h, w + 8, 4, "#8a5a32", "#4e3018", "#a8743f"); // 창턱
  }

  /**
   * 🦖 디지털 월드의 도감 — 액자 대신 휴대용 기기(디지바이스 느낌). 도감 수(9/153)는 HTML 글자로
   * 액정 한가운데(116, 41)에 얹힌다(.rm-txt.lcd). 위에 고리, 옆에 버튼 둘, 아래에 하나
   */
  function drawDigivice(g) {
    const cx = 117, cy = 38; // 액정 한가운데 — 도감 수 글자가 여기 얹힌다
    const OUT = "#24485a", BODY = "#cdeef7", HI = "#f4fcff", SH = "#93cfe0", SH2 = "#6fb2c7";
    oval(g, cx, 59, 21, 2, "#0000002a"); // 그림자
    // 안테나 — 왼쪽 위 검은 막대
    for (let i = 0; i < 7; i++) R(g, 99 + Math.floor(i / 2), 13 + i, 3, 1, i ? "#263238" : "#455a64");
    // 아래 발판 둘
    for (const fx of [103, 123]) { R(g, fx, 52, 10, 6, OUT); R(g, fx + 1, 52, 8, 5, BODY); R(g, fx + 1, 56, 8, 1, SH2); R(g, fx + 3, 53, 1, 3, SH); R(g, fx + 6, 53, 1, 3, SH); }
    // 몸체 — 팔각형에 가까운 통통한 꼴
    const rows = [];
    for (let y = 18; y <= 54; y++) {
      const d = Math.min(y - 18, 54 - y);
      const inset = d < 6 ? 6 - d : 0;
      rows.push([y, 95 + inset, 139 - inset]);
    }
    for (const [y, x0, x1] of rows) R(g, x0, y, x1 - x0 + 1, 1, OUT);
    for (const [y, x0, x1] of rows.slice(1, -1)) R(g, x0 + 1, y, x1 - x0 - 1, 1, BODY);
    for (const [y, x0, x1] of rows.slice(1, 10)) R(g, x0 + 1, y, x1 - x0 - 1, 1, y < 22 ? HI : BODY);
    for (const [y, x0, x1] of rows.slice(-8, -1)) R(g, x0 + 1, y, x1 - x0 - 1, 1, SH);
    // 양옆 줄진 손잡이
    for (let y = 24; y <= 50; y += 3) { R(g, 96, y, 6, 1, SH2); R(g, 133, y, 6, 1, SH2); R(g, 96, y + 1, 6, 1, HI); R(g, 133, y + 1, 6, 1, HI); }
    R(g, 102, 22, 1, 30, SH2); R(g, 132, 22, 1, 30, SH2);
    // 액정을 두른 둥근 테 — 둘레에 디지코드 눈금
    oval(g, cx, cy, 15, 15, OUT); oval(g, cx, cy, 14, 14, "#e9f8fc"); oval(g, cx, cy, 14, 14, HI, -14, -8);
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2 - Math.PI / 2;
      const px = Math.round(cx + Math.cos(a) * 11.5), py = Math.round(cy + Math.sin(a) * 11.5);
      R(g, px, py, k % 3 === 0 ? 2 : 1, 1, "#4a6f80");
    }
    // 액정 — 네모, 어두운 테두리, 점무늬
    R(g, 106, 30, 23, 17, OUT);
    R(g, 107, 31, 21, 15, "#b8cc98");
    for (let i = 0; i < 21; i += 2) for (let j = 0; j < 15; j += 2) R(g, 107 + i, 31 + j, 1, 1, "#aabf8a");
    R(g, 107, 31, 21, 1, "#d6e6bc");
    // 버튼 — 남색 타원(왼쪽 하나, 오른쪽 둘)
    const btn = (bx, by, rx, ry) => { oval(g, bx, by, rx + 1, ry + 1, "#1a237e"); oval(g, bx, by, rx, ry, "#3f51b5"); oval(g, bx, by, rx - 1, ry - 1, "#5c6bc0"); R(g, bx - 1, by - ry + 1, 2, 1, "#9fa8da"); };
    btn(99, 38, 3, 5);
    btn(135, 29, 3, 4);
    btn(135, 47, 3, 4);
  }

  /** 🦖 디지털 월드의 도감 자리 — 금테 안의 디지바이스(도트). 포켓몬 방은 dexFrameSvg */
  function drawDexFrame(g) {
    box(g, 100, 24, 32, 26, "#e2b93b", "#8a6a12", "#ffe28a", "#b8901e");
    R(g, 103, 27, 26, 20, "#fffaf0");
    drawDigivice(g);
  }

  /*
   * 🏅 결투 배지 진열장 — 1·10·30·100승마다 메달이 하나씩 걸린다(동 · 은 · 금 · 루비).
   * 체육관 배지 진열장 바로 위, 같은 폭(56). 캔버스에는 상자 · 남색 벨벳 · 메달 거는 못만 그리고
   * 메달은 SVG(duelMedal)로 위에 얹는다(render 의 rm-dub) — 10px 남짓한 도트로는 메달 모양이 안 나온다.
   * 100승이면 테가 금빛이 된다
   */
  const BADGE_AT = [1, 10, 30, 100];
  const DUB = { x: 136, y: 24, w: 56, h: 26 };
  function drawBadges(g, wins) {
    const { x, y, w, h } = DUB;
    if (wins >= 100) box(g, x, y, w, h, "#16204a", "#7a5608", "#ffe07a", "#c49000"); // 금테
    else box(g, x, y, w, h, "#16204a", "#1a110e", "#6d4c41", "#2b1d19");
    R(g, x + 2, y + 2, w - 4, h - 4, "#1c2a5c"); // 벨벳
    dither(g, x + 2, y + 2, w - 4, h - 4, "#18244f");
    R(g, x + 2, y + 2, w - 4, 1, "#00000055"); // 위 그늘
    for (let i = 0; i < 4; i++) {
      const cx = x + 2 + 6 + i * 13; // 칸 가운데(칸 폭 13)
      R(g, cx - 1, y + 3, 3, 2, "#c49000"); R(g, cx, y + 3, 1, 1, "#ffe07a"); // 메달 거는 못
    }
  }

  // 메달 — [밝은 · 가운데 · 짙은 금속, 리본 바깥 · 리본 가운데 줄]
  const MEDAL = [
    { m: ["#ffd9b0", "#cd7f32", "#6e3f14"], rb: ["#2e7d32", "#81c784"] }, // 1승 동
    { m: ["#ffffff", "#b8c4cc", "#5a6b75"], rb: ["#1565c0", "#90caf9"] }, // 10승 은
    { m: ["#fff6c2", "#f5b800", "#8a5a00"], rb: ["#c62828", "#ffcdd2"] }, // 30승 금
    { m: ["#ffd0d6", "#e0213f", "#6d0018"], rb: ["#6a1b9a", "#ffd54f"], rim: ["#fff6c2", "#f5b800", "#8a5a00"] }, // 100승 루비(금테 · 햇살)
  ];
  let medalUid = 0;
  /** 결투 메달 SVG(26 × 40) — 리본에 매단 둥근 메달, 가운데 별. got 이 false 면 점선 자리만 */
  function duelMedal(i, got) {
    const RIB_L = "M5 0 H12 L15 19 H9 Z", RIB_R = "M14 0 H21 L17 19 H11 Z";
    if (!got) {
      const dash = `fill="rgba(140,150,190,.14)" stroke="rgba(170,180,210,.42)" stroke-width="1.1" stroke-dasharray="2.4 2"`;
      return `<svg viewBox="0 0 26 40" aria-hidden="true"><path d="M8 1 L13 18 L18 1" fill="none" stroke="rgba(170,180,210,.3)" stroke-width="1.1" stroke-dasharray="2.4 2"/><circle cx="13" cy="28" r="9.5" ${dash}/></svg>`;
    }
    const t = MEDAL[i], rim = t.rim || t.m, g = "dm" + ++medalUid;
    // 별 — 다섯 꼭짓점(바깥 4.6 · 안 2)
    const star = Array.from({ length: 10 }, (_, k) => {
      const r = k % 2 ? 2 : 4.6, a = (k / 10) * Math.PI * 2 - Math.PI / 2;
      return `${(13 + Math.cos(a) * r).toFixed(2)} ${(28.2 + Math.sin(a) * r).toFixed(2)}`;
    }).join(" L");
    // 100승은 메달 뒤에 금빛 햇살(12갈래)
    const rays = t.rim ? `<path d="${Array.from({ length: 24 }, (_, k) => {
      const r = k % 2 ? 10 : 12, a = (k / 24) * Math.PI * 2;
      return `${k ? "L" : "M"}${(13 + Math.cos(a) * r).toFixed(2)} ${(28 + Math.sin(a) * r).toFixed(2)}`;
    }).join(" ")} Z" fill="url(#${g}r)" stroke="${rim[2]}" stroke-width=".6"/>` : "";
    return `<svg viewBox="0 0 26 40" aria-hidden="true">
      <defs>
        <linearGradient id="${g}r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".25" stop-color="${rim[0]}"/><stop offset=".62" stop-color="${rim[1]}"/><stop offset="1" stop-color="${rim[2]}"/></linearGradient>
        <linearGradient id="${g}f" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${t.m[0]}"/><stop offset=".55" stop-color="${t.m[1]}"/><stop offset="1" stop-color="${t.m[2]}"/></linearGradient>
        <radialGradient id="${g}h" cx="34%" cy="26%" r="45%"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".5" stop-color="#fff" stop-opacity=".2"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
        <clipPath id="${g}c"><circle cx="13" cy="28" r="9.5"/></clipPath>
      </defs>
      <path d="${RIB_L}" fill="${t.rb[0]}"/><path d="M7.6 0 H9.4 L12.1 19 H10.6 Z" fill="${t.rb[1]}"/>
      <path d="${RIB_R}" fill="${t.rb[0]}" style="filter:brightness(.82)"/><path d="M16.6 0 H18.4 L15.4 19 H13.9 Z" fill="${t.rb[1]}" opacity=".85"/>
      <rect x="9" y="17" width="8" height="3" rx="1" fill="${rim[2]}"/><rect x="9.5" y="17.4" width="7" height="1.2" rx=".6" fill="${rim[0]}" opacity=".8"/>
      ${rays}
      <circle cx="13" cy="30" r="9.5" fill="${rim[2]}"/>
      <circle cx="13" cy="28" r="9.5" fill="url(#${g}r)" stroke="${rim[2]}" stroke-width=".8"/>
      <circle cx="13" cy="28" r="7" fill="url(#${g}f)"/>
      <circle cx="13" cy="28" r="7" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".8"/>
      <path d="M${star} Z" transform="translate(0 .7)" fill="#000" opacity=".35"/>
      <path d="M${star} Z" fill="${t.m[0]}" stroke="#fff" stroke-opacity=".7" stroke-width=".5" stroke-linejoin="round"/>
      <g clip-path="url(#${g}c)"><ellipse cx="9" cy="23" rx="9" ry="6" fill="url(#${g}h)"/></g>
    </svg>`;
  }

  /*
   * 🏟️ 체육관 배지 진열장 — 결투 메달 진열장(DUB) 아래, 포스터 앞까지(56 × 32).
   * 캔버스에는 상자와 짙은 벨벳 · 배지 자리만 그린다. 배지는 체육관 탭과 같은 그림(gymart.js 의 SVG)을
   * 위에 얹는다(render 의 rm-gyb) — 도트로 줄여 찍으면 배지 모양이 뭉개진다.
   * 챔피언이 된 적이 있으면 상자 테가 금빛이 된다(위는 결투 메달 진열장이 붙어 있어 트로피 자리가 없다).
   */
  const GYB = { x: 136, y: 56, w: 56, h: 32 };
  const GYM_IDS = ["sprout", "wave", "ember", "spark", "omen", "lantern", "bedrock", "scale"];
  function drawGymBadges(g, champ) {
    const { x, y, w, h } = GYB;
    if (champ > 0) box(g, x, y, w, h, "#3a1420", "#7a5608", "#ffe07a", "#c49000"); // 금테
    else box(g, x, y, w, h, "#3a1420", "#1a110e", "#6d4c41", "#2b1d19");
    R(g, x + 2, y + 2, w - 4, h - 4, "#4a1a2a"); // 벨벳
    dither(g, x + 2, y + 2, w - 4, h - 4, "#401624");
    R(g, x + 2, y + 2, w - 4, 1, "#00000055"); // 위 그늘
    R(g, x + 3, y + h / 2, w - 6, 1, "#2a0e18"); // 가운데 선반
    for (let i = 0; i < 8; i++) {
      const cx = x + 8 + (i % 4) * 13, cy = y + 9 + Math.floor(i / 4) * 14;
      oval(g, cx, cy, 4, 4, "#33101c"); // 배지 꽂는 자리
    }
  }

  /* ================= 벽 장식 SVG =================
     도감 액자 · 주간 1위 메달 액자 · 기록 선반(챔피언 트로피 · 졸업장) · 포스터는 결투 메달 · 체육관 배지처럼 입체 SVG 로 그려
     캔버스 위에 얹는다(render 의 rm-wl). viewBox 가 그림 좌표 그대로라 숫자는 캔버스 좌표에서 x, y 를 뺀 값이다.
     디지털 월드의 디지바이스 · 간판은 도트 그대로 */
  let wallUid = 0;
  const GOLD = (id, dir = 'x1="0" y1="0" x2="1" y2="1"') => `<linearGradient id="${id}" ${dir}><stop offset="0" stop-color="#fff6c2"/><stop offset=".3" stop-color="#ffd54f"/><stop offset=".7" stop-color="#c49000"/><stop offset="1" stop-color="#8a5a00"/></linearGradient>`;
  const wallSvg = (x, y, w, h, body) => `<div class="rm-wl" style="left:${X(x)}%; top:${Y(y)}%; width:${X(w)}%; height:${Y(h)}%;"><svg viewBox="0 0 ${w} ${h}" aria-hidden="true">${body}</svg></div>`;

  /** 🖼️ 도감 액자(100, 24, 32 × 26) — 금테 · 크림색 대지 · 몬스터볼. 숫자는 글자로 얹는다(116, 41) */
  function dexFrameSvg() {
    const p = "wf" + ++wallUid;
    return wallSvg(100, 24, 32, 26, `<defs>${GOLD(p + "g")}
      <linearGradient id="${p}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="#f1e4c4"/></linearGradient>
      <linearGradient id="${p}r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8a80"/><stop offset=".45" stop-color="#e53935"/><stop offset="1" stop-color="#a31515"/></linearGradient>
      <linearGradient id="${p}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfd6de"/></linearGradient></defs>
      <rect x=".3" y=".3" width="31.4" height="25.4" rx="1.2" fill="url(#${p}g)" stroke="#7a5608" stroke-width=".6"/>
      <rect x="1.5" y="1.5" width="29" height="23" rx=".6" fill="none" stroke="#fff3b0" stroke-opacity=".75" stroke-width=".45"/>
      <rect x="2.7" y="2.7" width="26.6" height="20.6" fill="#7a5608"/>
      <rect x="3.1" y="3.1" width="25.8" height="19.8" fill="url(#${p}m)"/>
      <rect x="3.1" y="3.1" width="25.8" height="1" fill="#000" opacity=".12"/>
      ${[[1.4, 1.4], [30.6, 1.4], [1.4, 24.6], [30.6, 24.6]].map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r=".7" fill="#fff6c2" stroke="#8a5a00" stroke-width=".25"/>`).join("")}
      <ellipse cx="16.4" cy="14.6" rx="3.8" ry=".7" fill="#000" opacity=".14"/>
      <path d="M11.4 9.4 A4.6 4.6 0 0 1 20.6 9.4 Z" fill="url(#${p}r)"/>
      <path d="M11.4 9.4 A4.6 4.6 0 0 0 20.6 9.4 Z" fill="url(#${p}w)"/>
      <rect x="11.4" y="8.8" width="9.2" height="1.2" fill="#263238"/>
      <circle cx="16" cy="9.4" r="4.6" fill="none" stroke="#263238" stroke-width=".7"/>
      <circle cx="16" cy="9.4" r="1.7" fill="#263238"/><circle cx="16" cy="9.4" r="1.15" fill="#fafafa"/><circle cx="16" cy="9.4" r=".55" fill="#fff" stroke="#b0bec5" stroke-width=".2"/>
      <ellipse cx="13.9" cy="7" rx="1.5" ry=".75" fill="#fff" opacity=".7" transform="rotate(-30 13.9 7)"/>`);
  }

  /**
   * 🎖️ · 🏟️ 진열장 틀(SVG) — 결투 메달(DUB, 남색 벨벳 · 메달 거는 못 넷) · 체육관 배지(GYB, 자주 벨벳 · 가운데 선반 · 배지 자리 여덟).
   * gold 면 금테(100승 · 챔피언). 메달 · 배지 그림은 이 위에 따로(rm-dub · rm-gyb). 🦖 디지털 월드는 캔버스(drawBadges · drawGymBadges)
   */
  function caseSvg(B, gold, kind) {
    const p = "cs" + ++wallUid, { x, y, w, h } = B;
    const vel = kind === "duel" ? ["#25366e", "#16204a"] : ["#5a2034", "#3a1420"];
    const inner = kind === "duel"
      ? [0, 1, 2, 3].map((i) => { const cx = 8 + i * 13; return `<rect x="${cx - 1.5}" y="2.6" width="3" height="2" rx=".5" fill="url(#${p}g)" stroke="#8a5a00" stroke-width=".2"/>`; }).join("")
      : `<rect x="3" y="${h / 2 - .4}" width="${w - 6}" height="1.2" fill="#2a0e18"/><rect x="3" y="${h / 2 + .8}" width="${w - 6}" height=".5" fill="#fff" opacity=".06"/>`
        + Array.from({ length: 8 }, (_, i) => `<ellipse cx="${8 + (i % 4) * 13}" cy="${9 + Math.floor(i / 4) * 14}" rx="4.2" ry="4.2" fill="#000" opacity=".22"/>`).join("");
    return wallSvg(x, y, w, h, `<defs>${gold ? GOLD(p + "f") : WOOD(p + "f", "#8d6e63", "#5d4037", "#2b1d19")}${GOLD(p + "g")}
      <radialGradient id="${p}v" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="${vel[0]}"/><stop offset="1" stop-color="${vel[1]}"/></radialGradient></defs>
      <rect x=".8" y="1" width="${w}" height="${h}" rx="1.2" fill="#000" opacity=".18"/>
      <rect x=".3" y=".3" width="${w - .6}" height="${h - .6}" rx="1.2" fill="url(#${p}f)" stroke="${gold ? "#7a5608" : "#1a110e"}" stroke-width=".6"/>
      <rect x="1.4" y="1.4" width="${w - 2.8}" height="${h - 2.8}" rx=".6" fill="none" stroke="#fff" stroke-opacity="${gold ? .45 : .15}" stroke-width=".4"/>
      <rect x="2.2" y="2.2" width="${w - 4.4}" height="${h - 4.4}" fill="url(#${p}v)"/>
      <rect x="2.2" y="2.2" width="${w - 4.4}" height="1.2" fill="#000" opacity=".3"/>${inner}`);
  }

  /**
   * 🏅 길드 주간 1위 메달 액자(100, 56, 32 × 30) — 호두나무 테 · 남색 벨벳 · 월계관 두른 금메달.
   * 아래 남색 띠(87 ~ 95)에 1위 한 번마다 금빛 사선 줄(호봉 줄)이 하나씩 쌓이고, 다섯 줄이 모이면 별 하나가 된다.
   * 12번이면 ★★ + 줄 둘. 별은 다섯(25번)까지, 그 위는 별 옆에 작은 + 가 붙는다
   */
  function weekMedalSvg(count) {
    const p = "ww" + ++wallUid;
    const leaves = [];
    // 월계관 — 메달(16, 19) 둘레 반지름 7.4, 아래(90°)에서 양옆으로 올라간다. 잎은 둘레를 따라 눕는다
    for (let k = 0; k < 6; k++) {
      for (const deg of [112 + k * 22, 68 - k * 22]) {
        const a = (deg * Math.PI) / 180, x = (16 + Math.cos(a) * 7.4).toFixed(2), y = (19 + Math.sin(a) * 7.4).toFixed(2);
        leaves.push(`<ellipse cx="${x}" cy="${y}" rx="1.3" ry=".55" fill="${k % 2 ? "#43a047" : "#7cc47f"}" transform="rotate(${deg + 90} ${x} ${y})"/>`);
      }
    }
    // 호봉 띠 — 별(5번마다) 다음 사선 줄(나머지). 가운데 맞춤
    const stars = Math.min(5, Math.floor(count / 5)), lines = count >= 30 ? 0 : count % 5, more = count >= 30;
    const SW = 3.8, LW = 1.9, GAP = stars && lines ? 1 : 0;
    const width = stars * SW + lines * LW + (lines ? 1.1 : 0) + GAP + (more ? 2.4 : 0);
    let bx = 16 - width / 2;
    const marks = [];
    const starPath = (cx, cy, R, r) => Array.from({ length: 10 }, (_, k) => { const a = (k / 10) * Math.PI * 2 - Math.PI / 2, rr = k % 2 ? r : R; return `${k ? "L" : "M"}${(cx + Math.cos(a) * rr).toFixed(2)} ${(cy + Math.sin(a) * rr).toFixed(2)}`; }).join(" ") + " Z";
    for (let i = 0; i < stars; i++, bx += SW) marks.push(`<path d="${starPath(bx + SW / 2, 35.1, 1.8, .78)}" fill="url(#${p}g)" stroke="#8a5a00" stroke-width=".25"/>`);
    bx += GAP;
    for (let i = 0; i < lines; i++, bx += LW) marks.push(`<path d="M${bx.toFixed(2)} 37.6 H${(bx + 1.1).toFixed(2)} L${(bx + 2.2).toFixed(2)} 32.6 H${(bx + 1.1).toFixed(2)} Z" fill="url(#${p}g)" stroke="#8a5a00" stroke-width=".2"/>`);
    if (more) marks.push(`<path d="M${(bx + 1.2).toFixed(2)} 33.9 V36.3 M${(bx + .1).toFixed(2)} 35.1 H${(bx + 2.3).toFixed(2)}" stroke="#ffd54f" stroke-width=".7"/>`);
    const band = `<rect x="2" y="31.2" width="28" height="7.6" rx="1" fill="#1c275e" stroke="#0f163a" stroke-width=".4"/>
      <rect x="2.6" y="31.8" width="26.8" height="6.4" rx=".6" fill="none" stroke="#c49000" stroke-width=".35"/>
      <rect x="2.6" y="31.8" width="26.8" height="1" fill="#fff" opacity=".08"/>${marks.join("")}`;
    return wallSvg(100, 56, 32, 40, `<defs>${GOLD(p + "g")}${GOLD(p + "f", 'x1="1" y1="1" x2="0" y2="0"')}
      <linearGradient id="${p}w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8d6e63"/><stop offset=".5" stop-color="#5d4037"/><stop offset="1" stop-color="#3e2723"/></linearGradient>
      <radialGradient id="${p}v" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="#3a4ea6"/><stop offset="1" stop-color="#1c275e"/></radialGradient></defs>
      <rect x=".3" y=".3" width="31.4" height="29.4" rx="1" fill="url(#${p}w)" stroke="#2b1b17" stroke-width=".6"/>
      <rect x="1.4" y="1.4" width="29.2" height="27.2" fill="none" stroke="#a1887f" stroke-opacity=".6" stroke-width=".4"/>
      <rect x="2.6" y="2.6" width="26.8" height="24.8" fill="url(#${p}v)"/>
      <rect x="2.6" y="2.6" width="26.8" height="1" fill="#000" opacity=".25"/>
      <path d="M10.6 2.6 H14.6 L17.2 13.5 H13.2 Z" fill="#e53935"/><path d="M12 2.6 H13.2 L15.8 13.5 H14.6 Z" fill="#ffcdd2" opacity=".8"/>
      <path d="M17.4 2.6 H21.4 L18.8 13.5 H14.8 Z" fill="#1e88e5"/><path d="M18.8 2.6 H20 L17.4 13.5 H16.2 Z" fill="#bbdefb" opacity=".8"/>
      ${leaves.join("")}
      <circle cx="16" cy="20.2" r="6" fill="#6d4800"/>
      <circle cx="16" cy="19" r="6" fill="url(#${p}g)" stroke="#8a5a00" stroke-width=".5"/>
      <circle cx="16" cy="19" r="4.4" fill="url(#${p}f)"/>
      <text x="16" y="21.6" text-anchor="middle" font-size="7" font-weight="900" font-family="Arial, sans-serif" fill="#7a4a00">1</text>
      <text x="15.7" y="21.3" text-anchor="middle" font-size="7" font-weight="900" font-family="Arial, sans-serif" fill="#fff6c2">1</text>
      <ellipse cx="13.8" cy="16.4" rx="2.4" ry="1.3" fill="#fff" opacity=".45" transform="rotate(-30 13.8 16.4)"/>
      ${band}`);
  }

  /**
   * 🏆 기록 선반(230, 30, 80 × 36) — 왼쪽은 챔피언 트로피, 오른쪽은 졸업장.
   *   트로피: 🏆 챔피언 로드에서 우승할 때마다 하나(셋까지 서고, 넷부터는 위에 "×N" 글자 — render)
   *   졸업장: 졸업할 때마다 한 장씩 뒤로 쌓인다(오른쪽 위로 비켜서, 열 장까지). 맨 앞 장에 마지막 졸업생 이름(글자는 따로, 292, 44).
   *           누르면 졸업장 목록(openGrads)
   */
  function trophySvg(count, champ) {
    const p = "wt" + ++wallUid;
    const cup = (cx, k) => `<g transform="translate(${cx} 28) scale(${k}) translate(${-cx} -28)">
        <rect x="${cx - 4.6}" y="23.4" width="9.2" height="4.6" rx=".5" fill="url(#${p}b)" stroke="#3e2723" stroke-width=".35"/>
        <rect x="${cx - 2.6}" y="24.9" width="5.2" height="1.6" rx=".3" fill="url(#${p}g)"/>
        <path d="M${cx - 2.2} 23.4 L${cx - 1} 19.6 H${cx + 1} L${cx + 2.2} 23.4 Z" fill="url(#${p}g)" stroke="#8a5a00" stroke-width=".3"/>
        <ellipse cx="${cx}" cy="19.4" rx="1.8" ry=".8" fill="url(#${p}g)" stroke="#8a5a00" stroke-width=".3"/>
        <path d="M${cx - 4.5} 9.6 C${cx - 8.4} 9.4 ${cx - 8.2} 14.8 ${cx - 3.2} 15.2 M${cx + 4.5} 9.6 C${cx + 8.4} 9.4 ${cx + 8.2} 14.8 ${cx + 3.2} 15.2" fill="none" stroke="#c49000" stroke-width="1.1"/>
        <path d="M${cx - 5.2} 8 H${cx + 5.2} C${cx + 5.2} 14.2 ${cx + 2.6} 18.2 ${cx} 18.6 C${cx - 2.6} 18.2 ${cx - 5.2} 14.2 ${cx - 5.2} 8 Z" fill="url(#${p}c)" stroke="#8a5a00" stroke-width=".4"/>
        <ellipse cx="${cx}" cy="8" rx="5.2" ry="1.1" fill="#ffe082" stroke="#8a5a00" stroke-width=".35"/>
        <ellipse cx="${cx}" cy="8.1" rx="4.2" ry=".65" fill="#a87400"/>
        <path d="M${cx - 3.4} 9.6 C${cx - 3.4} 13 ${cx - 2.2} 15.4 ${cx - 1} 16.4" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width=".8" stroke-linecap="round"/>
        <path d="M${cx} 10.4 L${cx + .75} 12 L${cx + 2.4} 12.2 L${cx + 1.15} 13.3 L${cx + 1.5} 15 L${cx} 14.1 L${cx - 1.5} 15 L${cx - 1.15} 13.3 L${cx - 2.4} 12.2 L${cx - .75} 12 Z" fill="#fff6c2" stroke="#a87400" stroke-width=".25"/>
      </g>`;
    const cups = Array.from({ length: Math.min(3, champ) }, (_, i) => cup(11 + i * 14, i === 0 ? 1 : 0.82)).join("");
    const certs = count > 0 ? `${Array.from({ length: Math.min(10, count) - 1 }, (_, i) => {
        const k = Math.min(10, count) - 1 - i; // 뒤에서부터 — 오래된 장일수록 더 비켜 있다
        return `<g transform="translate(${(k * 1.25).toFixed(2)} ${(-k * 1.1).toFixed(2)}) rotate(${k % 2 ? -2.2 : 2} 62 16)">
          <rect x="50.6" y="4.6" width="24" height="24" fill="#000" opacity=".12"/>
          <rect x="50" y="4" width="24" height="24" fill="${k % 3 === 1 ? "#f6efdd" : "#faf5e8"}" stroke="#a8956f" stroke-width=".45"/>
          <rect x="51.6" y="5.6" width="20.8" height="20.8" fill="none" stroke="#c9a227" stroke-opacity=".7" stroke-width=".45"/></g>`;
      }).join("")}
      <rect x="51" y="5" width="24" height="24" fill="#000" opacity=".18"/>
      <rect x="50" y="4" width="24" height="24" fill="#fdfaf2" stroke="#9e8a6a" stroke-width=".5"/>
      <rect x="51.6" y="5.6" width="20.8" height="20.8" fill="none" stroke="#c9a227" stroke-width=".6"/>
      <rect x="52.4" y="6.4" width="19.2" height="19.2" fill="none" stroke="#c9a227" stroke-width=".25"/>
      <rect x="56" y="7.6" width="12" height="1.1" rx=".5" fill="#90a4ae"/>
      <path d="M67.4 23.2 L66.2 27.4 L67.6 26.6 L68.4 27.8 L69 23.6 Z M70.2 23.2 L71.4 27.4 L70 26.6 L69.2 27.8 L68.6 23.6 Z" fill="#c62828"/>
      <circle cx="68.8" cy="22.4" r="2.4" fill="#e53935" stroke="#8e0000" stroke-width=".35"/>
      <circle cx="68.8" cy="22.4" r="1.3" fill="none" stroke="#ffcdd2" stroke-width=".35"/>` : "";
    return wallSvg(230, 30, 80, 36, `<defs>${GOLD(p + "g")}
      <linearGradient id="${p}c" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c49000"/><stop offset=".22" stop-color="#fff3b0"/><stop offset=".45" stop-color="#ffd54f"/><stop offset=".8" stop-color="#c49000"/><stop offset="1" stop-color="#ffd54f"/></linearGradient>
      <linearGradient id="${p}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6d4c41"/><stop offset="1" stop-color="#3e2723"/></linearGradient>
      <linearGradient id="${p}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b08066"/><stop offset=".35" stop-color="#8d6e63"/><stop offset="1" stop-color="#5d4037"/></linearGradient></defs>
      <path d="M10 31.4 H13 L11.5 36 H10 Z M66 31.4 H69 V36 H67.5 Z" fill="#4e342e"/>
      <rect x="2" y="28" width="76" height="3.6" rx=".6" fill="url(#${p}s)" stroke="#3e2723" stroke-width=".35"/>
      <rect x="2.4" y="28.3" width="75.2" height=".6" fill="#d7b49e" opacity=".7"/>
      ${certs}
      ${cups}`);
  }

  /** 🖼️ 포스터(196, 18, 26 × 36) — 산 · 해 · 구름 · 새. 위 두 모서리에 테이프 */
  function posterSvg() {
    const p = "wp" + ++wallUid;
    return wallSvg(196, 18, 26, 36, `<defs>
      <linearGradient id="${p}k" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5fb4f5"/><stop offset="1" stop-color="#d6f0ff"/></linearGradient>
      <linearGradient id="${p}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6aa985"/><stop offset="1" stop-color="#3f7356"/></linearGradient>
      <linearGradient id="${p}n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fb9c9"/><stop offset="1" stop-color="#6b93a6"/></linearGradient>
      <radialGradient id="${p}s"><stop offset="0" stop-color="#fff59d"/><stop offset=".45" stop-color="#ffd54f"/><stop offset="1" stop-color="#ffd54f" stop-opacity="0"/></radialGradient>
      <clipPath id="${p}c"><rect x="2" y="2" width="22" height="21"/></clipPath></defs>
      <rect x=".8" y=".8" width="26" height="36" fill="#000" opacity=".15"/>
      <rect x="0" y="0" width="26" height="36" fill="#fffaf0" stroke="#d7c4a8" stroke-width=".4"/>
      <g clip-path="url(#${p}c)">
        <rect x="2" y="2" width="22" height="21" fill="url(#${p}k)"/>
        <circle cx="19" cy="7" r="4" fill="url(#${p}s)"/><circle cx="19" cy="7" r="1.8" fill="#fff59d"/>
        <ellipse cx="7" cy="6.5" rx="3" ry="1.1" fill="#fff" opacity=".9"/><ellipse cx="8.6" cy="5.9" rx="1.8" ry="1" fill="#fff" opacity=".9"/>
        <path d="M9 9 l1 .8 l1 -.8 M12.4 7.6 l.8 .6 l.8 -.6" fill="none" stroke="#37474f" stroke-width=".4" stroke-linecap="round"/>
        <path d="M2 23 L2 17 L9 11 L13.5 15 L17 12.5 L24 18 V23 Z" fill="url(#${p}n)"/>
        <path d="M2 23 V19.5 L7.5 13.5 L16 23 Z" fill="url(#${p}m)"/>
        <path d="M5.6 15.6 L7.5 13.5 L9.6 15.8 L8.6 15.4 L7.6 16.4 L6.6 15.2 Z" fill="#fff"/>
        <path d="M10 23 L18.5 15.5 L24 20.5 V23 Z" fill="#4a7a5b"/>
        <rect x="2" y="21.6" width="22" height="1.4" fill="#7cb342"/>
      </g>
      <rect x="2" y="2" width="22" height="21" fill="none" stroke="#bfae92" stroke-width=".4"/>
      <rect x="5" y="25.6" width="16" height="2" rx=".6" fill="#8d6e63"/>
      <rect x="7" y="29.4" width="12" height=".9" rx=".4" fill="#bcaaa4"/><rect x="8.5" y="31.6" width="9" height=".8" rx=".4" fill="#d7ccc8"/>
      <rect x="-1.4" y="-1" width="6.4" height="2.8" fill="#fff59d" opacity=".7" transform="rotate(-14 1.8 .4)"/>
      <rect x="21" y="-1" width="6.4" height="2.8" fill="#fff59d" opacity=".7" transform="rotate(14 24.2 .4)"/>`);
  }

  /** 🪟 창틀 · 커튼(18, 18, 80 × 62) — 하늘은 캔버스가 그 안(29, 27, 58 × 44)에 그린다(theme · 시간대마다 달라서) */
  function windowSvg() {
    const p = "wn" + ++wallUid;
    const curtain = (x, flip) => {
      const folds = [1.6, 3.6, 5.6].map((f) => `<path d="M${x + f} 3 C${x + f + (flip ? -.4 : .4)} 20 ${x + f + (flip ? .6 : -.6)} 40 ${x + f + (flip ? -.8 : .8)} 57" fill="none" stroke="#a63d3d" stroke-opacity=".55" stroke-width=".7"/>`).join("");
      return `<path d="M${x} 2.6 H${x + 8} C${x + 8} 22 ${x + (flip ? 8.6 : 7.4)} 42 ${x + (flip ? 9.6 : 8.6)} 57.4 H${x + (flip ? -1.6 : -.6)} C${x + (flip ? 1 : -1)} 42 ${x} 22 ${x} 2.6 Z" fill="url(#${p}c)" stroke="#8e2f2f" stroke-width=".4"/>${folds}
        <path d="M${x - .4} 34 Q${x + 4} 36.2 ${x + 8.4} 34 V36 Q${x + 4} 38.2 ${x - .4} 36 Z" fill="#ffd54f" stroke="#a87400" stroke-width=".3"/>`;
    };
    return wallSvg(18, 18, 80, 62, `<defs>
      <linearGradient id="${p}w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b07a4a"/><stop offset=".5" stop-color="#7a4e2a"/><stop offset="1" stop-color="#5a3518"/></linearGradient>
      <linearGradient id="${p}c" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c85656"/><stop offset=".35" stop-color="#ef7d7d"/><stop offset=".7" stop-color="#d96a6a"/><stop offset="1" stop-color="#b94f4f"/></linearGradient>
      <linearGradient id="${p}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
      <path d="M8 6 H72 V56 H8 Z M11 9 V53 H69 V9 Z" fill="url(#${p}w)" fill-rule="evenodd" stroke="#3e2410" stroke-width=".5"/>
      <rect x="11" y="9" width="58" height="44" fill="url(#${p}g)"/>
      <path d="M14 30 L30 12 M18 34 L36 13" stroke="#fff" stroke-opacity=".25" stroke-width="1.6"/>
      <rect x="11" y="9" width="58" height="1" fill="#000" opacity=".2"/>
      <rect x="39" y="9" width="2" height="44" fill="#f1e7d6" stroke="#bfae92" stroke-width=".3"/><rect x="11" y="30" width="58" height="2" fill="#f1e7d6" stroke="#bfae92" stroke-width=".3"/>
      ${curtain(5, false)}${curtain(67, true)}
      <rect x="2" y="1" width="76" height="2.6" rx="1.3" fill="#5e3a1d"/><rect x="2" y="1.2" width="76" height=".7" rx=".35" fill="#a8743f"/>
      <circle cx="2" cy="2.3" r="2" fill="#c49000"/><circle cx="78" cy="2.3" r="2" fill="#c49000"/><circle cx="1.4" cy="1.7" r=".6" fill="#fff3b0"/><circle cx="77.4" cy="1.7" r=".6" fill="#fff3b0"/>
      <rect x="4" y="56" width="72" height="4" rx=".6" fill="url(#${p}w)" stroke="#3e2410" stroke-width=".4"/><rect x="4.4" y="56.3" width="71.2" height=".8" fill="#c99566"/>
      <rect x="6" y="60" width="68" height="1.2" fill="#000" opacity=".15"/>`);
  }

  /**
   * 🌳 바깥 들판의 나무 게시판 — 하늘에 떠 있던 벽 장식(액자 · 진열장 · 선반 · 포스터 · 시계)을 받쳐 준다.
   * 장식이 차지한 자리(rects)를 x 로 이어 붙여 무리마다 판 하나: 지붕 처마 · 가로 널빤지 · 땅에 박힌 기둥
   */
  /** 게시판 무리 — 장식 자리(rects)를 x 로 이어 붙여(14px 안쪽 틈은 한 판) 판 · 지붕 · 기둥 자리를 낸다 */
  function boardGroups(rects) {
    const rs = rects.map(([x, y, w, h]) => [x, y, x + w, y + h]).sort((a, b) => a[0] - b[0]);
    const groups = [];
    for (const r of rs) {
      const g = groups[groups.length - 1];
      if (g && r[0] <= g[2] + 14) { g[1] = Math.min(g[1], r[1]); g[2] = Math.max(g[2], r[2]); g[3] = Math.max(g[3], r[3]); }
      else groups.push([...r]);
    }
    return groups.map(([x0, y0, x1, y1]) => {
      const L = Math.max(1, x0 - 5), Rt = Math.min(AW - 1, x1 + 5), T0 = Math.max(9, y0 - 4), B = Math.min(FLOOR - 10, y1 + 4), w = Rt - L;
      return { L, Rt, T0, B, w, posts: w > 100 ? [L + 7, (L + Rt) / 2, Rt - 7] : [L + 7, Rt - 7] };
    });
  }

  /** 🦖 디지털 월드의 같은 게시판 — 도트로, 바탕 캔버스에(디지바이스 · 간판 · 진열장보다 먼저) */
  function fieldBoardPixel(g, rects) {
    for (const { L, Rt, T0, B, w, posts } of boardGroups(rects)) {
      const G = FLOOR + 4;
      for (const px of posts) { oval(g, Math.round(px), G, 5, 1, "#00000038"); box(g, Math.round(px) - 2, B - 2, 5, G - B + 2, "#8a5a32", "#3e2410", "#a8743f", "#5e3a1d"); }
      box(g, Math.round(L), T0, Math.round(w), B - T0, "#a87848", "#4e3018", "#c99566", "#7a4e2a");
      for (let y = T0 + 7; y < B - 2; y += 7) R(g, Math.round(L) + 1, y, Math.round(w) - 2, 1, "#7d5230");
      for (let y = T0 + 3; y < B - 2; y += 7) { R(g, Math.round(L) + 2, y, 1, 1, "#3e2410"); R(g, Math.round(Rt) - 3, y, 1, 1, "#3e2410"); }
      for (let i = 0; i < 7; i++) { const ins = 6 - i; R(g, Math.round(L) - 4 + ins, T0 - 7 + i, Math.round(w) + 8 - ins * 2, 1, i === 0 ? "#9a5530" : i % 2 ? "#7a3f22" : "#6e3820"); }
      for (let x = Math.round(L) + 2; x < Rt; x += 6) R(g, x, T0 - 6, 1, 6, "#4e2412");
      R(g, Math.round(L) - 4, T0 - 1, Math.round(w) + 8, 1, "#3e2410");
    }
  }

  function fieldBoardSvg(rects) {
    if (!rects.length) return "";
    const p = "fb" + ++wallUid;
    const out = boardGroups(rects).map(({ L, Rt, T0, B, w, posts }) => {
      return `${posts.map((px) => `<ellipse cx="${px}" cy="${FLOOR + 4}" rx="5" ry="1.4" fill="#000" opacity=".22"/><rect x="${px - 2.2}" y="${B - 2}" width="4.4" height="${FLOOR + 4 - B + 2}" fill="url(#${p}p)" stroke="#3e2410" stroke-width=".4"/>`).join("")}
        <rect x="${L}" y="${T0}" width="${w}" height="${B - T0}" rx="1" fill="url(#${p}w)" stroke="#4e3018" stroke-width=".6"/>
        ${Array.from({ length: Math.floor((B - T0) / 7) }, (_, i) => `<path d="M${L + 1} ${T0 + 7 + i * 7} H${Rt - 1}" stroke="#6e4524" stroke-opacity=".55" stroke-width=".5"/>`).join("")}
        ${[L + 2.5, Rt - 2.5].map((nx) => Array.from({ length: Math.floor((B - T0) / 7) + 1 }, (_, i) => `<circle cx="${nx}" cy="${T0 + 3.5 + i * 7}" r=".45" fill="#3e2410"/>`).join("")).join("")}
        <path d="M${L - 4} ${T0} L${L + 3} ${T0 - 7} H${Rt - 3} L${Rt + 4} ${T0} Z" fill="url(#${p}r)" stroke="#3e2410" stroke-width=".5"/>
        ${Array.from({ length: Math.floor((w + 2) / 6) }, (_, i) => `<path d="M${L + 2 + i * 6} ${T0 - 6.6} V${T0 - .4}" stroke="#3e2410" stroke-opacity=".35" stroke-width=".4"/>`).join("")}
        <rect x="${L - 4}" y="${T0 - .6}" width="${w + 8}" height="1.4" fill="#3e2410" opacity=".55"/>`;
    }).join("");
    return `<div class="rm-wl" style="left:0; top:0; width:100%; height:100%;"><svg viewBox="0 0 ${AW} ${AH}" aria-hidden="true"><defs>
      <linearGradient id="${p}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b98a57"/><stop offset="1" stop-color="#8d5f34"/></linearGradient>
      <linearGradient id="${p}p" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5e3a1d"/><stop offset=".4" stop-color="#8a5a32"/><stop offset="1" stop-color="#4e3018"/></linearGradient>
      <linearGradient id="${p}r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8d4a2a"/><stop offset="1" stop-color="#5d2e18"/></linearGradient></defs>${out}</svg></div>`;
  }

  /** 러그(92, 152, 136 × 32) — 바닥에 깔린 타원 무늬 양탄자, 양 끝에 술 */
  function rugSvg() {
    const p = "rg" + ++wallUid;
    const dots = [];
    for (let i = 0; i < 360; i += 15) {
      const a = (i * Math.PI) / 180, x = 68 + Math.cos(a) * 56, y = 16 + Math.sin(a) * 10.4;
      dots.push(`<path d="M${(x - 1.6).toFixed(2)} ${y.toFixed(2)} L${x.toFixed(2)} ${(y - .7).toFixed(2)} L${(x + 1.6).toFixed(2)} ${y.toFixed(2)} L${x.toFixed(2)} ${(y + .7).toFixed(2)} Z" fill="#ffe0b2"/>`);
    }
    const fringe = [-1, 1].map((s) => Array.from({ length: 7 }, (_, k) => `<path d="M${68 + s * 65.4} ${10.6 + k * 1.8} h${s * 2.6}" stroke="#f3e5c0" stroke-width=".6"/>`).join("")).join("");
    return `<div class="rm-wl rug" style="left:${X(92)}%; top:${Y(152)}%; width:${X(136)}%; height:${Y(32)}%;"><svg viewBox="0 0 136 32" aria-hidden="true"><defs>
      <radialGradient id="${p}a" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="#ef6b6b"/><stop offset=".7" stop-color="#d64545"/><stop offset="1" stop-color="#b03030"/></radialGradient>
      <radialGradient id="${p}b" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffb74d"/><stop offset="1" stop-color="#e0605a"/></radialGradient></defs>
      ${fringe}
      <ellipse cx="68" cy="17" rx="66" ry="14" fill="#000" opacity=".18"/>
      <ellipse cx="68" cy="16" rx="66" ry="14" fill="#7a1a1a"/>
      <ellipse cx="68" cy="16" rx="63.5" ry="12.4" fill="url(#${p}a)"/>
      <ellipse cx="68" cy="16" rx="60" ry="11.2" fill="none" stroke="#ffcdd2" stroke-opacity=".6" stroke-width=".5" stroke-dasharray="2 1.4"/>
      ${dots.join("")}
      <ellipse cx="68" cy="16" rx="50" ry="8.8" fill="#c43a3a" stroke="#8e1f1f" stroke-width=".5"/>
      <ellipse cx="68" cy="16" rx="21" ry="4.4" fill="url(#${p}b)" stroke="#8e1f1f" stroke-width=".4"/>
      <path d="M55 16 L68 13 L81 16 L68 19 Z" fill="#fff3e0" opacity=".75"/>
      <circle cx="68" cy="16" r="1.4" fill="#8e1f1f"/>
      <path d="M30 16 L36 14 L42 16 L36 18 Z M94 16 L100 14 L106 16 L100 18 Z" fill="#ffcc80" opacity=".8"/>
    </svg></div>`;
  }

  /**
   * 🌤️ 방 조명 — 도트 벽지 · 바닥 위에 한 겹(320 × 200 그대로). 입체 가구와 결을 맞춘다.
   *   벽: 천장 쪽 그늘 · 걸레받이 쪽 살짝 어둡게   바닥: 벽 밑 그늘 · 앞쪽 가장자리 비네트
   *   걸레받이: 테마 색(T.trim)으로 둥근 몰딩 + 바닥에 지는 그림자
   *   창빛: 낮엔 하얀, 저녁엔 주황 빛이 창 아래 바닥으로 비스듬히 떨어진다(밤 · 동굴은 없다)
   * 바깥 들판 테마(digital) · 길드 홀의 바깥 배경은 벽이 아니라 하늘이라 걸레받이 · 벽 그늘을 뺀다
   */
  function roomLightSvg(theme, T, per, win) {
    const p = "lt" + ++wallUid, F = FLOOR, out = theme === "digital";
    const [mid, dark, hi] = T.trim;
    const sun = win && !out && theme !== "cave" && per !== "night" ? (per === "evening" ? "#ffb070" : "#fff6dc") : null;
    return `<div class="rm-light"><svg viewBox="0 0 ${AW} ${AH}" preserveAspectRatio="none" aria-hidden="true"><defs>
      <linearGradient id="${p}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".16"/><stop offset=".22" stop-color="#000" stop-opacity="0"/><stop offset=".8" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".1"/></linearGradient>
      <linearGradient id="${p}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".22"/><stop offset=".25" stop-color="#000" stop-opacity="0"/><stop offset=".85" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient>
      <radialGradient id="${p}v" cx="50%" cy="45%" r="75%"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></radialGradient>
      <linearGradient id="${p}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset=".35" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></linearGradient>
      <linearGradient id="${p}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sun || "#fff"}" stop-opacity=".22"/><stop offset="1" stop-color="${sun || "#fff"}" stop-opacity="0"/></linearGradient>
      <radialGradient id="${p}g" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${sun || "#fff"}" stop-opacity=".2"/><stop offset="1" stop-color="${sun || "#fff"}" stop-opacity="0"/></radialGradient></defs>
      ${out ? "" : `<rect width="${AW}" height="${F - 6}" fill="url(#${p}w)"/>`}
      <rect y="${F}" width="${AW}" height="${AH - F}" fill="url(#${p}f)"/>
      ${sun ? `<ellipse cx="58" cy="49" rx="46" ry="36" fill="url(#${p}g)"/><path d="M30 ${F} H86 L150 ${AH} H58 Z" fill="url(#${p}s)"/>` : ""}
      ${out ? "" : `<rect y="${F - 7}" width="${AW}" height="7" fill="url(#${p}b)"/><rect y="${F - 7}" width="${AW}" height=".7" fill="${hi}" opacity=".9"/><rect y="${F - 4.6}" width="${AW}" height=".5" fill="${dark}" opacity=".5"/><rect y="${F}" width="${AW}" height="2.4" fill="#000" opacity=".16"/>`}
      <rect width="${AW}" height="${AH}" fill="url(#${p}v)"/>
    </svg></div>`;
  }

  /* ================= 바닥 가구 SVG — 자리 · 크기(w, h)는 FURN 그대로. p 는 그라데이션 id 앞머리 ================= */
  const WOOD = (id, a = "#c08955", b = "#9c6b3f", c = "#6e4524") => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>`;
  const FURN_SVG = {
    lamp: (p) => `<defs>
      <linearGradient id="${p}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e8a94a"/><stop offset=".35" stop-color="#fff3d6"/><stop offset=".7" stop-color="#ffd28a"/><stop offset="1" stop-color="#d9913a"/></linearGradient>
      <linearGradient id="${p}p" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8d6e63"/><stop offset=".5" stop-color="#c49a7a"/><stop offset="1" stop-color="#4e342e"/></linearGradient>
      <radialGradient id="${p}g" cx="50%" cy="100%" r="70%"><stop offset="0" stop-color="#fff8e1"/><stop offset="1" stop-color="#fff8e1" stop-opacity="0"/></radialGradient></defs>
      <rect x="8" y="13" width="2" height="43.5" fill="url(#${p}p)"/>
      <circle cx="9" cy="35" r="1.1" fill="#c49000"/>
      <path d="M4.2 .6 H13.8 L17.2 13.4 H.8 Z" fill="url(#${p}s)" stroke="#b8741f" stroke-width=".5" stroke-linejoin="round"/>
      <path d="M6.6 .8 L5.4 13.2 M9 .8 V13.2 M11.4 .8 L12.6 13.2" stroke="#e0a050" stroke-opacity=".5" stroke-width=".4"/>
      <ellipse cx="9" cy="13.2" rx="7.6" ry="2.4" fill="url(#${p}g)"/>
      <rect x=".6" y="12.8" width="16.8" height="1.4" rx=".7" fill="#b8741f"/><rect x="4" y=".2" width="10" height=".9" rx=".45" fill="#b8741f"/>
      <path d="M4.6 56.4 H13.4 L15.4 59.2 H2.6 Z" fill="#6d4c41" stroke="#3b2621" stroke-width=".35"/>
      <rect x="1.6" y="59" width="14.8" height="2.8" rx="1.1" fill="#3b2621"/><rect x="2.4" y="59.2" width="13.2" height=".7" rx=".35" fill="#6d4c41"/>`,
    bed: (p) => `<defs>${WOOD(p + "w")}
      <linearGradient id="${p}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dcdcdc"/></linearGradient>
      <linearGradient id="${p}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fb2f6"/><stop offset=".5" stop-color="#5b8def"/><stop offset="1" stop-color="#3a68c8"/></linearGradient></defs>
      <ellipse cx="35" cy="35.4" rx="34" ry="1.2" fill="#000" opacity=".2"/>
      <rect x="8.6" y="31" width="3.2" height="4.8" fill="#5e3a1d"/><rect x="57.6" y="31" width="3.2" height="4.8" fill="#5e3a1d"/>
      <rect x="6" y="25.6" width="58" height="6" rx="1" fill="url(#${p}w)" stroke="#5e3a1d" stroke-width=".5"/>
      <rect x="6.4" y="26" width="57.2" height=".8" fill="#d9a46c" opacity=".7"/>
      <rect x="7" y="16" width="56" height="11" rx="2" fill="url(#${p}m)" stroke="#9e9e9e" stroke-width=".45"/>
      <rect x="9" y="10.6" width="14.4" height="8.6" rx="3.4" fill="url(#${p}m)" stroke="#bdbdbd" stroke-width=".45"/>
      <path d="M12 14.6 Q16 13.4 20.4 14.8" fill="none" stroke="#d6d6d6" stroke-width=".5"/>
      <path d="M24 13 H61.4 Q63.4 13 63.4 15 V28.4 Q63.4 29.6 62 29.6 H24 Z" fill="url(#${p}b)" stroke="#2f5bb5" stroke-width=".5"/>
      ${[32, 40, 48, 56].map((x) => `<path d="M${x} 13.6 V29" stroke="#3f6fd0" stroke-width=".55" stroke-dasharray="1.2 .8"/>`).join("")}
      <path d="M24 21 H63" stroke="#3f6fd0" stroke-width=".5" stroke-dasharray="1.2 .8"/>
      <path d="M24 13 H28.4 V29.6 H24 Z" fill="#f4f4f4" stroke="#bdbdbd" stroke-width=".4"/>
      <path d="M28 14.4 Q40 13.6 61 14.6" stroke="#fff" stroke-opacity=".45" stroke-width=".8" fill="none"/>
      <path d="M0 36 V3.4 Q0 .2 4 .2 Q8 .2 8 3.4 V36 Z" fill="url(#${p}w)" stroke="#5e3a1d" stroke-width=".5"/>
      <rect x="1.8" y="5" width="4.4" height="20" rx="1" fill="none" stroke="#6e4524" stroke-opacity=".6" stroke-width=".5"/>
      <path d="M62 36 V15 Q62 12 66 12 Q70 12 70 15 V36 Z" fill="url(#${p}w)" stroke="#5e3a1d" stroke-width=".5"/>
      <circle cx="4" cy="2.4" r=".9" fill="#d9a46c"/><circle cx="66" cy="14.2" r=".9" fill="#d9a46c"/>`,
    aquarium: (p) => `<defs>${WOOD(p + "w", "#a1887f", "#8d6e63", "#5d4037")}
      <linearGradient id="${p}a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b6ecff"/><stop offset=".25" stop-color="#5cc0ea"/><stop offset="1" stop-color="#1f7fb0"/></linearGradient>
      <linearGradient id="${p}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2dea6"/><stop offset="1" stop-color="#c9ad6a"/></linearGradient></defs>
      <ellipse cx="19" cy="35.4" rx="18" ry="1" fill="#000" opacity=".2"/>
      <rect x="2" y="26" width="34" height="10" rx=".8" fill="url(#${p}w)" stroke="#4e342e" stroke-width=".45"/>
      <rect x="4.4" y="28.2" width="13.6" height="6" rx=".5" fill="none" stroke="#4e342e" stroke-opacity=".6" stroke-width=".4"/><rect x="20" y="28.2" width="13.6" height="6" rx=".5" fill="none" stroke="#4e342e" stroke-opacity=".6" stroke-width=".4"/>
      <circle cx="16.4" cy="31.2" r=".55" fill="#ffd54f"/><circle cx="21.6" cy="31.2" r=".55" fill="#ffd54f"/>
      <rect x=".3" y=".3" width="37.4" height="26.4" rx="1" fill="url(#${p}a)" stroke="#2b4f66" stroke-width=".6"/>
      <path d="M1 20.6 Q10 19.4 19 20.8 T37 20.4 V26 H1 Z" fill="url(#${p}s)"/>
      ${[[5, 10, 1], [8.2, 7, -1], [30, 12, 1], [33.4, 8, -1]].map(([x, h, s]) => `<path d="M${x} 21 C${x + s * 1.6} ${21 - h / 3} ${x - s * 1.6} ${21 - h * 2 / 3} ${x + s * .6} ${21 - h}" fill="none" stroke="#3e9a4a" stroke-width="1.1" stroke-linecap="round"/>`).join("")}
      <ellipse cx="20" cy="22" rx="3.4" ry="2" fill="#9e9e9e"/><ellipse cx="19.2" cy="21.3" rx="1.6" ry=".7" fill="#d6d6d6"/>
      <circle cx="26" cy="15" r=".7" fill="none" stroke="#e1f5fe" stroke-width=".35"/><circle cx="26.8" cy="10.6" r=".5" fill="none" stroke="#e1f5fe" stroke-width=".35"/><circle cx="25.6" cy="7" r=".9" fill="none" stroke="#e1f5fe" stroke-width=".35"/>
      <rect x="1" y="3.4" width="36" height="1" fill="#e1f5fe" opacity=".75"/>
      <path d="M4 26 L14 1 H18 L8 26 Z" fill="#fff" opacity=".13"/>
      <rect x="0" y="0" width="38" height="2.6" rx=".8" fill="#2b4f66"/><rect x=".6" y=".4" width="36.8" height=".6" fill="#5b88a3"/>`,
    tv: (p) => `<defs>
      <linearGradient id="${p}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#52525e"/><stop offset=".15" stop-color="#34343e"/><stop offset="1" stop-color="#1b1b22"/></linearGradient>
      <linearGradient id="${p}k" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5ab8f0"/><stop offset="1" stop-color="#c4ecff"/></linearGradient>
      <linearGradient id="${p}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fe08f"/><stop offset="1" stop-color="#43a047"/></linearGradient>
      <clipPath id="${p}c"><rect x="5" y="3" width="30" height="20" rx="1.6"/></clipPath></defs>
      <ellipse cx="20" cy="37.4" rx="17" ry="1" fill="#000" opacity=".22"/>
      <rect x="4" y="28" width="32" height="10" rx="1" fill="url(#${p}b)" stroke="#111116" stroke-width=".5"/>
      <rect x="14" y="30" width="12" height="5" rx=".8" fill="#e8e8e8" stroke="#757575" stroke-width=".4"/><rect x="15" y="31.6" width="7" height="1.4" rx=".4" fill="#9e9e9e"/><circle cx="23.6" cy="32.3" r=".6" fill="#e53935"/>
      <rect x="2" y="0" width="36" height="28" rx="2.4" fill="url(#${p}b)" stroke="#111116" stroke-width=".5"/>
      <rect x="4.4" y="2.4" width="31.2" height="21.2" rx="2" fill="#0d0d12"/>
      <g clip-path="url(#${p}c)">
        <rect x="5" y="3" width="30" height="20" fill="url(#${p}k)"/>
        <circle cx="28" cy="8" r="2.6" fill="#ffe082"/><circle cx="28" cy="8" r="4" fill="#ffe082" opacity=".25"/>
        <path d="M5 16 Q14 13.4 22 15.4 T35 14.6 V23 H5 Z" fill="url(#${p}h)"/>
        <path d="M10.4 13 A3.2 3.2 0 0 1 16.8 13 Z" fill="#e53935"/><path d="M10.4 13 A3.2 3.2 0 0 0 16.8 13 Z" fill="#fafafa"/>
        <rect x="10.4" y="12.6" width="6.4" height=".8" fill="#222"/><circle cx="13.6" cy="13" r="1" fill="#222"/><circle cx="13.6" cy="13" r=".55" fill="#fff"/>
        <path d="M5 3 L19 3 L9 23 H5 Z" fill="#fff" opacity=".12"/>
      </g>
      ${[25, 26.2].map((y) => `<rect x="7" y="${y}" width="8" height=".5" rx=".25" fill="#55555f"/><rect x="25" y="${y}" width="8" height=".5" rx=".25" fill="#55555f"/>`).join("")}
      <circle cx="20" cy="25.6" r=".8" fill="#ff5252"/><circle cx="20" cy="25.6" r="1.6" fill="#ff5252" opacity=".3"/>`,
    desk: (p) => `<defs>${WOOD(p + "w")}
      <linearGradient id="${p}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5f7f8"/><stop offset="1" stop-color="#b0bec5"/></linearGradient>
      <linearGradient id="${p}s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#26325a"/><stop offset="1" stop-color="#121a33"/></linearGradient></defs>
      <ellipse cx="28" cy="39.4" rx="27" ry="1" fill="#000" opacity=".2"/>
      <rect x="2" y="22" width="3.2" height="18" fill="#7a5030"/><rect x="50.8" y="22" width="3.2" height="18" fill="#7a5030"/>
      <rect x="33" y="22.6" width="18" height="10.4" rx=".6" fill="url(#${p}w)" stroke="#5e3a1d" stroke-width=".45"/>
      <rect x="39.6" y="26.8" width="4.8" height="1.2" rx=".6" fill="#e0c08a" stroke="#8a5a32" stroke-width=".25"/>
      <rect x="0" y="18" width="56" height="5" rx=".8" fill="url(#${p}w)" stroke="#5e3a1d" stroke-width=".45"/><rect x=".4" y="18.3" width="55.2" height=".8" fill="#e0b07a" opacity=".8"/>
      <rect x="17.6" y="15.4" width="4.8" height="2.8" fill="#78909c"/>
      <rect x="6" y="0" width="28" height="16" rx="1.4" fill="url(#${p}m)" stroke="#455a64" stroke-width=".45"/>
      <rect x="7.8" y="1.8" width="24.4" height="11.6" rx=".8" fill="url(#${p}s)"/>
      ${[["#7ee787", 3], ["#79c0ff", 6], ["#ffa657", 4], ["#d2a8ff", 7], ["#7ee787", 5]].map(([c, w], i) => `<rect x="${10 + (i % 2) * 2}" y="${3 + i * 2}" width="${w}" height=".9" rx=".45" fill="${c}"/><rect x="${11 + (i % 2) * 2 + w}" y="${3 + i * 2}" width="${3 + ((i * 5) % 6)}" height=".9" rx=".45" fill="#8b949e"/>`).join("")}
      <path d="M8 2 L17 2 L10.6 13.4 H8 Z" fill="#fff" opacity=".07"/>
      <rect x="9" y="16" width="22" height="2.2" rx=".6" fill="#eceff1" stroke="#90a4ae" stroke-width=".35"/>
      ${Array.from({ length: 9 }, (_, i) => `<rect x="${10 + i * 2.3}" y="16.6" width="1.6" height=".9" rx=".2" fill="#cfd8dc"/>`).join("")}
      <path d="M46 12.4 C49 12.4 49 16.6 46 16.6" fill="none" stroke="#bdbdbd" stroke-width=".9"/>
      <path d="M40 11 H46 V17 Q46 18 45 18 H41 Q40 18 40 17 Z" fill="#fafafa" stroke="#9e9e9e" stroke-width=".4"/><rect x="40.3" y="12.6" width="5.4" height="1.2" fill="#e57373"/>
      <path d="M42 9.6 C41 8.4 43 7.6 42 6.2 M44.2 9.4 C43.2 8.2 45.2 7.4 44.2 6" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width=".45" stroke-linecap="round"/>`,
    shelf: (p) => `<defs>${WOOD(p + "w", "#8d6e63", "#5d4037", "#2a1a16")}
      <linearGradient id="${p}i" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2e1d18"/><stop offset=".25" stop-color="#4e342e"/><stop offset="1" stop-color="#5d4037"/></linearGradient>
      <linearGradient id="${p}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c49a7a"/><stop offset="1" stop-color="#8d6e63"/></linearGradient></defs>
      <rect x=".3" y=".3" width="37.4" height="63.4" rx="1.2" fill="url(#${p}w)" stroke="#1e120e" stroke-width=".5"/>
      <rect x="3" y="3" width="32" height="58" fill="url(#${p}i)"/>
      ${[3, 24, 45].map((y) => `<rect x="3" y="${y}" width="32" height="1.6" fill="#000" opacity=".25"/>`).join("")}
      <rect x="3" y="21" width="32" height="3" fill="url(#${p}b)"/><rect x="3" y="42" width="32" height="3" fill="url(#${p}b)"/>
      ${[[10, 12, "#eeeeee"], [20, 12, "#ef9a9a"], [30, 12, "#90caf9"], [10, 33, "#a5d6a7"], [20, 33, "#ce93d8"]].map(([cx, cy, c]) => `<ellipse cx="${cx}" cy="${cy + 8.2}" rx="4" ry=".6" fill="#000" opacity=".3"/>
        <circle cx="${cx}" cy="${cy + 2}" r="4.6" fill="${c}" stroke="#000" stroke-opacity=".3" stroke-width=".4"/>
        <circle cx="${cx}" cy="${cy + 2}" r="2.8" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".4"/>
        <circle cx="${cx}" cy="${cy + 2}" r="1.1" fill="#4e342e"/><circle cx="${cx}" cy="${cy + 2}" r=".45" fill="#2a1a16"/>
        <path d="M${cx - 3} ${cy - .2} A3.6 3.6 0 0 1 ${cx} ${cy - 1.6}" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width=".7" stroke-linecap="round"/>`).join("")}
      ${[["#ffcc80", 3, 14], ["#80cbc4", 4, 12], ["#ef9a9a", 3, 15], ["#9fa8da", 4, 13], ["#fff59d", 3, 11]].reduce((a, [c, w, h]) => { a.s += `<rect x="${a.x}" y="${61 - h}" width="${w}" height="${h}" rx=".4" fill="${c}" stroke="#000" stroke-opacity=".3" stroke-width=".3"/><rect x="${a.x}" y="${61 - h + 2}" width="${w}" height=".8" fill="#000" opacity=".2"/><rect x="${a.x}" y="${61 - h}" width=".6" height="${h}" fill="#fff" opacity=".35"/>`; a.x += w + 1; return a; }, { x: 6, s: "" }).s}
      <path d="M27 61 L33.6 49.6 L35 50.4 L28.6 61 Z" fill="#ffab91" stroke="#000" stroke-opacity=".3" stroke-width=".3"/>`,
    plant: (p) => `<defs>
      <linearGradient id="${p}t" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e07a45"/><stop offset=".4" stop-color="#f09a68"/><stop offset="1" stop-color="#a84418"/></linearGradient>
      <radialGradient id="${p}l" cx="35%" cy="35%" r="70%"><stop offset="0" stop-color="#9ccc65"/><stop offset="1" stop-color="#4f8a2b"/></radialGradient></defs>
      <ellipse cx="12" cy="41.4" rx="8" ry=".8" fill="#000" opacity=".22"/>
      <path d="M4 30.6 H20 L18 41.6 Q17.8 42 17.2 42 H6.8 Q6.2 42 6 41.6 Z" fill="url(#${p}t)" stroke="#8e3a14" stroke-width=".45"/>
      <rect x="2.6" y="26" width="18.8" height="5" rx="1" fill="url(#${p}t)" stroke="#8e3a14" stroke-width=".45"/>
      <ellipse cx="12" cy="26.4" rx="8.4" ry="1.1" fill="#5d4037"/>
      <path d="M12 26.4 C11.4 20 12.8 14 12 8" fill="none" stroke="#4f8a2b" stroke-width="1.6" stroke-linecap="round"/>
      ${[[6, 16, -20, 5.4], [18, 13, 20, 5.4], [7, 22, -10, 4.4], [17, 21, 14, 4.4]].map(([x, y, r, w]) => `<g transform="rotate(${r} ${x} ${y})"><ellipse cx="${x}" cy="${y}" rx="${w}" ry="2.2" fill="url(#${p}l)" stroke="#3b6b20" stroke-width=".35"/><path d="M${x - w + .8} ${y} H${x + w - .8}" stroke="#d4e8b8" stroke-opacity=".7" stroke-width=".4"/></g>`).join("")}
      ${[[7, 6, "#e53935"], [17, 4, "#1e88e5"], [12, 2.4, "#fdd835"]].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="2.8" fill="${c}" stroke="#000" stroke-opacity=".25" stroke-width=".35"/><circle cx="${x - .9}" cy="${y - .9}" r=".9" fill="#fff" opacity=".75"/>`).join("")}`,
    cushion: (p) => `<defs>
      <radialGradient id="${p}r" cx="40%" cy="20%" r="80%"><stop offset="0" stop-color="#ff8a80"/><stop offset=".5" stop-color="#e53935"/><stop offset="1" stop-color="#a31515"/></radialGradient>
      <radialGradient id="${p}w" cx="40%" cy="10%" r="90%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfd6de"/></radialGradient>
      <clipPath id="${p}c"><ellipse cx="14" cy="10" rx="13.4" ry="7.6"/></clipPath></defs>
      <ellipse cx="14" cy="16" rx="13" ry="1.8" fill="#000" opacity=".22"/>
      <g clip-path="url(#${p}c)"><rect x="0" y="0" width="28" height="10" fill="url(#${p}r)"/><rect x="0" y="10" width="28" height="9" fill="url(#${p}w)"/><rect x="0" y="9.1" width="28" height="1.8" fill="#212121"/></g>
      <ellipse cx="14" cy="10" rx="13.4" ry="7.6" fill="none" stroke="#212121" stroke-width=".6"/>
      <circle cx="14" cy="10" r="3" fill="#212121"/><circle cx="14" cy="10" r="2" fill="#fafafa"/><circle cx="14" cy="10" r="1" fill="#fff" stroke="#bdbdbd" stroke-width=".25"/>
      <ellipse cx="9" cy="5" rx="3.4" ry="1.2" fill="#fff" opacity=".45" transform="rotate(-12 9 5)"/>
      ${[[1.4, 10], [26.6, 10], [14, 2.4], [14, 17.6]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".7" fill="#212121"/>`).join("")}`,
  };

  /* ================= 바닥 가구 (하나씩 따로 그린다) ================= */

  // x, y, w, h 는 그림 좌표. 아랫변(y + h)이 클수록 앞에 선다
  const FURN = {
    lamp: { x: 6, y: 70, w: 18, h: 62, draw(g) {
      for (let i = 0; i < 14; i++) {
        const w = 10 + Math.floor((i * 6) / 13), x = (18 - w) >> 1;
        R(g, x, i, w, 1, i === 0 || i === 13 ? "#b8741f" : "#ffd28a");
        R(g, x, i, 1, 1, "#b8741f"); R(g, x + w - 1, i, 1, 1, "#b8741f");
        if (i > 1 && i < 12) R(g, x + 2, i, 1, 1, "#fff0c8");
      }
      R(g, 8, 14, 2, 42, "#5d4037"); R(g, 8, 14, 1, 42, "#7b5a4c");
      R(g, 4, 56, 10, 3, "#4e342e"); R(g, 4, 56, 10, 1, "#6d4c41"); R(g, 2, 59, 14, 3, "#3b2621");
    } },
    bed: { x: 28, y: 98, w: 70, h: 36, draw(g) {
      box(g, 0, 0, 8, 36, "#9c6b3f", "#5e3a1d", "#b5834f", "#7a5030"); // 머리판
      box(g, 62, 12, 8, 24, "#9c6b3f", "#5e3a1d", "#b5834f", "#7a5030"); // 발판
      box(g, 7, 26, 56, 6, "#8d5a34", "#5e3a1d", "#a8743f");
      R(g, 9, 32, 3, 4, "#5e3a1d"); R(g, 58, 32, 3, 4, "#5e3a1d");
      box(g, 7, 16, 56, 11, "#f4f4f4", "#9e9e9e", "#ffffff"); // 매트리스
      box(g, 9, 11, 14, 8, "#ffffff", "#bdbdbd", null, "#e0e0e0"); // 베개
      box(g, 24, 13, 39, 14, "#5b8def", "#2f5bb5", "#86aaf4", "#4a76cc"); // 이불
      for (let x = 28; x < 60; x += 8) R(g, x, 15, 1, 11, "#4a76cc");
      R(g, 24, 13, 4, 14, "#f4f4f4"); R(g, 24, 13, 1, 14, "#bdbdbd"); // 접힌 이불깃
    } },
    aquarium: { x: 104, y: 96, w: 38, h: 36, draw(g) {
      box(g, 2, 26, 34, 10, "#8d6e63", "#4e342e", "#a1887f"); // 받침
      box(g, 0, 0, 38, 27, "#3fa7d6", "#2b4f66", "#7fd0f0", "#2f8fbf");
      R(g, 1, 1, 36, 3, "#cfefff"); R(g, 1, 4, 36, 1, "#8fd8f7");
      R(g, 1, 21, 36, 5, "#e8d39a"); dither(g, 1, 21, 36, 1, "#d4bd80");
      for (const [x, hgt] of [[5, 9], [8, 6], [30, 11], [33, 7]]) for (let i = 0; i < hgt; i++) R(g, x + (i % 3 === 0 ? 1 : 0), 21 - i, 1, 1, "#3e9a4a");
      oval(g, 20, 22, 3, 2, "#9e9e9e"); // 돌
    } },
    tv: { x: 148, y: 94, w: 40, h: 38, draw(g) {
      box(g, 4, 28, 32, 10, "#3e3e48", "#1d1d24", "#5a5a66");
      box(g, 14, 30, 12, 5, "#e0e0e0", "#757575", "#ffffff"); R(g, 22, 32, 2, 1, "#e53935"); // 게임기
      box(g, 2, 0, 36, 28, "#2b2b33", "#111116", "#4a4a55");
      R(g, 5, 3, 30, 20, "#7ed4ff"); R(g, 5, 15, 30, 8, "#64c26a"); R(g, 5, 15, 30, 1, "#8fe08f");
      oval(g, 28, 8, 3, 3, "#ffe082");
      oval(g, 14, 13, 3, 3, "#e53935", -3, -1); oval(g, 14, 13, 3, 3, "#fafafa", 0, 3); R(g, 11, 13, 7, 1, "#222"); // 화면 속 공
      R(g, 5, 3, 30, 1, "#bfeaff");
      R(g, 17, 25, 6, 1, "#ff5252"); // 전원 불빛
    } },
    desk: { x: 194, y: 92, w: 56, h: 40, draw(g) {
      box(g, 0, 18, 56, 5, "#a0703f", "#5e3a1d", "#c08955");
      R(g, 2, 23, 3, 17, "#7a5030"); R(g, 51, 23, 3, 17, "#7a5030");
      box(g, 33, 23, 18, 10, "#8d5a34", "#5e3a1d", "#a8743f"); R(g, 40, 27, 4, 1, "#e0c08a"); // 서랍
      box(g, 6, 0, 28, 16, "#cfd8dc", "#455a64", "#eceff1");
      R(g, 8, 2, 24, 11, "#1b2440");
      const code = [["#7ee787", 3], ["#79c0ff", 6], ["#ffa657", 4], ["#d2a8ff", 7], ["#7ee787", 5]];
      code.forEach(([c, w], i) => { R(g, 10 + (i % 2) * 2, 3 + i * 2, w, 1, c); R(g, 10 + (i % 2) * 2 + w + 1, 3 + i * 2, 3 + ((i * 5) % 6), 1, "#8b949e"); });
      R(g, 18, 16, 4, 2, "#455a64"); R(g, 9, 16, 22, 2, "#eceff1"); R(g, 9, 17, 22, 1, "#b0bec5"); // 받침 · 키보드
      box(g, 40, 11, 6, 7, "#ffffff", "#9e9e9e"); R(g, 46, 13, 2, 3, "#9e9e9e"); // 머그컵
      R(g, 42, 8, 1, 2, "#ffffff88"); R(g, 44, 7, 1, 2, "#ffffff88");
    } },
    shelf: { x: 256, y: 68, w: 38, h: 64, draw(g) {
      box(g, 0, 0, 38, 64, "#3e2723", "#2a1a16", "#8d6e63", "#5d4037");
      R(g, 3, 3, 32, 58, "#4e342e");
      R(g, 3, 21, 32, 3, "#8d6e63"); R(g, 3, 42, 32, 3, "#8d6e63");
      const disc = (cx, cy, c) => { oval(g, cx, cy, 5, 5, "#0007"); oval(g, cx, cy, 5, 5, c, -5, 4); oval(g, cx, cy, 1, 1, "#4e342e"); R(g, cx - 3, cy - 3, 2, 1, "#ffffffaa"); };
      disc(10, 12, "#e0e0e0"); disc(20, 12, "#ef9a9a"); disc(30, 12, "#90caf9");
      disc(10, 33, "#a5d6a7"); disc(20, 33, "#ce93d8");
      [["#ffcc80", 3, 14], ["#80cbc4", 4, 12], ["#ef9a9a", 3, 15], ["#9fa8da", 4, 13], ["#fff59d", 3, 11]].reduce((x, [c, w, h]) => { R(g, x, 61 - h, w, h, c); R(g, x, 61 - h, 1, h, "#0003"); return x + w + 1; }, 6);
    } },
    plant: { x: 290, y: 150, w: 24, h: 42, draw(g) {
      for (let i = 0; i < 12; i++) { const w = 16 - Math.floor(i / 3); R(g, (24 - w) >> 1, 30 + i, w, 1, i === 11 ? "#8e3a14" : "#d0602a"); }
      box(g, 3, 26, 18, 5, "#b8501f", "#8e3a14", "#e07a45");
      R(g, 11, 8, 2, 19, "#4f8a2b");
      oval(g, 6, 16, 5, 2, "#6aa83a"); oval(g, 18, 13, 5, 2, "#6aa83a"); oval(g, 7, 22, 4, 2, "#5c9a32"); oval(g, 17, 21, 4, 2, "#5c9a32");
      const berry = (x, y, c, hi) => { oval(g, x, y, 3, 3, c); R(g, x - 1, y - 2, 1, 1, hi); };
      berry(7, 6, "#e53935", "#ffcdd2"); berry(17, 4, "#1e88e5", "#bbdefb"); berry(12, 2, "#fdd835", "#fff9c4");
    } },
    cushion: { x: 24, y: 172, w: 28, h: 18, draw(g) {
      oval(g, 14, 15, 13, 2, "#0003");
      oval(g, 14, 10, 13, 8, "#c62828", -8, -1); oval(g, 14, 10, 12, 7, "#e53935", -7, -1);
      oval(g, 14, 10, 13, 6, "#e0e0e0", 0, 6); oval(g, 14, 10, 12, 5, "#fafafa", 0, 5);
      R(g, 1, 9, 26, 2, "#212121"); oval(g, 14, 10, 3, 3, "#212121"); oval(g, 14, 10, 2, 2, "#fafafa");
      R(g, 7, 4, 3, 1, "#ff8a80");
    } },
  };

  /* ================= 🦖 디지털 월드의 가구 — 자리 · 크기(w, h)는 FURN 그대로, 그림만 =================
     이름은 메인(main/room.js FURNI_DG)이 준다. 데이터 등불 · 디지타마 둥지 · 고기밭 · 자판기 · 건초 침대 ·
     디지바이스 단말기 · 초원의 TV · 공중전화 부스 */
  const FURN_DG = {
    lamp(g) { // 데이터 등불 — 나무 기둥 위 빛나는 수정
      R(g, 8, 18, 2, 38, "#6d4c41"); R(g, 8, 18, 1, 38, "#8d6e63");
      R(g, 4, 56, 10, 3, "#5d4037"); R(g, 2, 59, 14, 3, "#3e2723");
      R(g, 5, 15, 8, 3, "#795548");
      for (let i = 0; i < 14; i++) { const w = i < 7 ? 1 + i : 14 - i; R(g, 9 - (w >> 1) - 1, i + 1, w + 2, 1, i < 7 ? "#7ff3ff" : "#3cc6e0"); }
      R(g, 8, 3, 1, 5, "#e8ffff"); R(g, 10, 6, 1, 2, "#e8ffff");
    },
    bed(g) { // 건초 침대 — 낮은 나무 틀 위 볏짚 더미
      box(g, 4, 24, 62, 8, "#8d5a34", "#5e3a1d", "#a8743f");
      R(g, 6, 32, 3, 4, "#5e3a1d"); R(g, 61, 32, 3, 4, "#5e3a1d");
      oval(g, 35, 20, 31, 8, "#d9b44a"); oval(g, 35, 19, 29, 6, "#ecd06a");
      const r = seeded(61);
      for (let i = 0; i < 70; i++) { const x = 8 + Math.floor(r() * 54), y = 13 + Math.floor(r() * 12); R(g, x, y, 3, 1, r() < 0.5 ? "#c9a23a" : "#f6e08a"); }
      oval(g, 14, 16, 7, 4, "#f2e6c8"); oval(g, 14, 15, 6, 3, "#fffaf0"); // 베개 대신 큰 잎
    },
    aquarium(g) { // 공중전화 부스 — 초록 지붕, 유리, 안의 전화기
      const x0 = 9;
      box(g, x0, 2, 20, 34, "#2e7d32", "#1b5e20", "#4caf50");
      R(g, x0 - 1, 0, 22, 4, "#1b5e20"); R(g, x0, 0, 20, 1, "#66bb6a");
      R(g, x0 + 3, 6, 14, 26, "#bfe8f5"); R(g, x0 + 3, 6, 14, 2, "#e6f7fc"); R(g, x0 + 9, 6, 1, 26, "#2e7d32");
      box(g, x0 + 4, 16, 6, 8, "#81c784", "#1b5e20"); R(g, x0 + 5, 18, 4, 1, "#1b5e20"); R(g, x0 + 5, 20, 4, 1, "#1b5e20"); // 전화기
      R(g, x0 + 11, 12, 1, 6, "#ffffff88");
    },
    tv(g) { // 초원의 TV — 나무 상자 TV 와 안테나, 화면엔 지지직
      R(g, 13, 0, 1, 6, "#9e9e9e"); R(g, 27, 1, 1, 5, "#9e9e9e"); R(g, 12, 0, 3, 1, "#cfd8dc"); R(g, 26, 0, 3, 1, "#cfd8dc");
      box(g, 2, 6, 36, 28, "#8d5a34", "#4e3018", "#a8743f");
      R(g, 6, 10, 22, 18, "#6f7f86");
      const r = seeded(71);
      for (let i = 0; i < 70; i++) R(g, 6 + Math.floor(r() * 22), 10 + Math.floor(r() * 18), 1, 1, r() < 0.5 ? "#dfe7ea" : "#4a575d");
      R(g, 31, 11, 3, 3, "#3e2723"); R(g, 31, 17, 3, 3, "#3e2723"); R(g, 32, 24, 2, 1, "#ff5252");
      R(g, 6, 34, 3, 4, "#4e3018"); R(g, 31, 34, 3, 4, "#4e3018");
    },
    desk(g) { // 디지바이스 단말기 — 돌 받침 위 화면, 디지코드가 흐른다
      box(g, 12, 22, 32, 18, "#8a8f98", "#4b5058", "#b5bac2", "#6b7078");
      R(g, 14, 30, 28, 1, "#6b7078");
      box(g, 6, 0, 44, 22, "#37474f", "#1c262b", "#546e7a");
      R(g, 9, 3, 38, 15, "#06221a");
      for (let i = 0; i < 5; i++) for (let j = 0; j < 9; j++) if ((i * 7 + j * 3) % 4) R(g, 11 + j * 4, 5 + i * 3, 2, 1, i === 4 ? "#7dffd0" : "#2bd99b");
      R(g, 22, 19, 12, 2, "#2bd99b"); R(g, 24, 19, 2, 2, "#e8fff6");
    },
    shelf(g) { // 자판기 — 빨간 몸통, 음료 진열, 투입구
      box(g, 0, 0, 38, 64, "#d32f2f", "#7f1d1d", "#ef5350", "#b71c1c");
      R(g, 3, 4, 32, 30, "#e3f2fd"); R(g, 3, 4, 32, 1, "#ffffff");
      const col = ["#42a5f5", "#ffca28", "#66bb6a", "#ef5350", "#ab47bc", "#26c6da"];
      for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) { R(g, 5 + i * 5, 7 + row * 9, 3, 6, col[(i + row * 2) % 6]); R(g, 5 + i * 5, 7 + row * 9, 3, 1, "#ffffffaa"); }
      for (let i = 0; i < 6; i++) R(g, 5 + i * 5, 14 + 9 * 2 + 1, 3, 1, "#90a4ae");
      R(g, 4, 38, 20, 6, "#212121"); R(g, 6, 40, 16, 1, "#7dffd0"); // 표시창
      R(g, 28, 38, 4, 8, "#b71c1c"); R(g, 29, 40, 2, 4, "#212121"); // 동전 구멍
      box(g, 6, 50, 26, 9, "#424242", "#212121", "#616161"); // 꺼내는 곳
    },
    plant(g) { // 고기밭 — 흙더미에서 뼈 붙은 고기가 자란다
      oval(g, 12, 36, 11, 5, "#6d4c41"); oval(g, 12, 35, 10, 4, "#8d6e63");
      const meat = (x, y) => {
        R(g, x - 1, y + 7, 2, 8, "#fafafa"); R(g, x - 2, y + 14, 4, 2, "#fafafa"); // 뼈
        oval(g, x, y + 3, 5, 6, "#b5482a"); oval(g, x - 1, y + 2, 4, 5, "#d4683f"); R(g, x - 2, y, 2, 2, "#f0a07a");
      };
      meat(7, 10); meat(17, 6);
      R(g, 2, 30, 2, 4, "#4f9a3a"); R(g, 21, 29, 2, 5, "#4f9a3a");
    },
    cushion(g) { // 디지타마 둥지 — 잔가지 둥지에 깨진 알껍데기
      oval(g, 14, 15, 13, 2, "#0003");
      oval(g, 14, 11, 13, 6, "#8d6e63"); oval(g, 14, 10, 11, 4, "#a1887f");
      for (let i = 0; i < 12; i++) R(g, 3 + i * 2, 9 + (i % 3), 3, 1, "#6d4c41");
      R(g, 7, 6, 4, 4, "#fffaf0"); R(g, 8, 5, 2, 1, "#fffaf0"); R(g, 17, 5, 5, 5, "#fffaf0"); R(g, 19, 4, 1, 1, "#fffaf0");
      R(g, 8, 7, 1, 1, "#7ec8a9"); R(g, 19, 7, 2, 1, "#7ec8a9");
    },
  };
  /** 🦖 꽃밭(러그 자리) */
  function drawFlowerBed(g) {
    oval(g, 160, 168, 66, 14, "#5aa83c"); oval(g, 160, 168, 62, 12, "#6fbf4f");
    const r = seeded(83);
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r());
      const x = Math.round(160 + Math.cos(a) * 58 * d), y = Math.round(168 + Math.sin(a) * 10 * d);
      const c = ["#ffffff", "#ffd54f", "#ff8fb1", "#b39ddb", "#ff7043"][i % 5];
      R(g, x, y, 2, 1, c); R(g, x, y + 1, 1, 1, "#3a7a2a");
    }
  }
  /** 🦖 이정표(포스터 자리) — 나무 기둥과 화살표 판 */
  function drawSign(g) {
    const x = 196, y = 18;
    R(g, x + 11, y + 10, 4, 34, "#795548"); R(g, x + 11, y + 10, 1, 34, "#a1887f");
    for (let i = 0; i < 12; i++) R(g, x + 22 + Math.floor(i / 2) * 0 + (i < 6 ? i : 11 - i), y + 4 + i, 1, 1, "#5d4037");
    box(g, x - 2, y + 4, 26, 12, "#a1887f", "#5d4037", "#d7ccc8");
    for (let i = 0; i < 6; i++) R(g, x + 24 + i, y + 4 + i, 1, 12 - i * 2, "#a1887f");
    R(g, x + 2, y + 8, 3, 1, "#3e2723"); R(g, x + 7, y + 8, 5, 1, "#3e2723"); R(g, x + 14, y + 8, 4, 1, "#3e2723"); R(g, x + 4, y + 11, 10, 1, "#3e2723");
  }

  /* ================= 포켓몬이 가는 자리 ================= */

  // % 로 바꾼다. 포켓몬 자리(x)는 몸 가운데, y 는 발이 닿는 높이(방 높이의 %)
  const X = (ax) => (ax / AW) * 100;
  const Y = (ay) => (ay / AH) * 100;
  const WALK = { x0: 6, x1: 88, y0: 71, y1: 96 }; // 걸어 다니는 바닥
  const SPOT = {
    plant: { x: X(278), y: Y(190), face: -1 }, // 화분 왼쪽에서 오른쪽을 본다
    cushion: { x: X(38), y: Y(178), face: 1 },
    bed: { x: X(66), y: Y(117), face: 1 },
    tv: { x: X(168), y: Y(150), face: 1 },
    fountain: { x: X(160), y: Y(176), face: 1 },
  };

  const rooms = new Set();

  /* ================= 코인 가구 (deco.json) =================
     사탕 가구는 자리가 정해져 있지만 코인 가구는 놓을 자리를 고른다(placeCoin) — 자리 후보
     (spots)를 차례로 보고, 이미 놓인 가구 · 벽 장식과 겹치지 않는 첫 자리에 둔다. 다 겹치면
     가장 덜 겹치는 자리. 바닥 가구의 후보는 [왼쪽 x, 아랫변 y], 벽에 거는 것은 [x, y].
     anim 이 있는 것은 0.25초마다 다시 그린다(불꽃 · 음표 · 게임기 화면 · 네온 · 회복기 불빛). */

  const FONT = { P: ["111", "101", "111", "100", "100"], O: ["111", "101", "101", "101", "111"], K: ["101", "101", "110", "101", "101"], E: ["111", "100", "110", "100", "111"] };
  function line(g, x0, y0, x1, y1, c) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
    for (let i = 0; i <= n; i++) R(g, Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1, c);
  }

  const COIN = {
    clock: { wall: true, anim: true, w: 26, h: 26, spots: [[150, 58], [204, 60], [60, 4], [240, 4]], draw(g) {
      oval(g, 13, 13, 12, 12, "#3a2a24"); oval(g, 13, 13, 11, 11, "#e53935", -11, -1); oval(g, 13, 13, 11, 11, "#f2f2f2", 0, 11);
      oval(g, 8, 5, 3, 1, "#ff8a80");
      R(g, 1, 12, 25, 2, "#2a2020");
      oval(g, 13, 13, 8, 8, "#2a2020"); oval(g, 13, 13, 7, 7, "#fffaf0");
      for (const [x, y] of [[13, 7], [19, 13], [13, 19], [7, 13]]) R(g, x, y, 1, 1, "#b0a090");
      const d = new Date(), hr = (((d.getHours() % 12) + d.getMinutes() / 60) / 12) * Math.PI * 2, mn = (d.getMinutes() / 60) * Math.PI * 2;
      line(g, 13, 13, Math.round(13 + Math.sin(mn) * 6), Math.round(13 - Math.cos(mn) * 6), "#1b1b1b");
      line(g, 13, 13, Math.round(13 + Math.sin(hr) * 4), Math.round(13 - Math.cos(hr) * 4), "#e53935");
      R(g, 13, 13, 1, 1, "#1b1b1b");
    } },
    neon: { wall: true, anim: true, w: 50, h: 20, spots: [[196, 62], [146, 60], [140, 2]], draw(g, t) {
      box(g, 0, 0, 50, 20, "#1b1530", "#0d0a1a", "#2a2148");
      const on = t % 14 !== 0; // 가끔 한 번 꺼졌다 켜진다
      const heart = ["01100110", "11111111", "11111111", "01111110", "00111100", "00011000"];
      const paint = (bits, ox, oy, s, c, glow) => {
        for (let pass = 0; pass < 2; pass++) bits.forEach((row, j) => [...row].forEach((b, i) => {
          if (b !== "1") return;
          for (let p = 0; p < s; p++) for (let q = 0; q < s; q++) {
            const x = ox + i * s + p, y = oy + j * s + q;
            if (pass === 0 && on) { R(g, x - 1, y, 3, 1, glow); R(g, x, y - 1, 1, 3, glow); }
            else if (pass === 1) R(g, x, y, 1, 1, on ? c : "#4a3a5a");
          }
        }));
      };
      paint(heart, 4, 7, 1, "#ff6fb0", "#ff6fb055");
      let x = 15;
      for (const ch of "POKE") { paint(FONT[ch], x, 5, 2, "#7ff3ff", "#7ff3ff44"); x += 8; }
    } },
    beanbag: { w: 60, h: 36, spots: [[58, 188], [150, 186], [226, 186]], draw(g) {
      oval(g, 30, 33, 27, 2, "#00000033");
      for (const ex of [13, 47]) for (let i = 0; i < 5; i++) R(g, ex - 1 - Math.floor(i / 2), 4 + i, 3 + Math.floor(i / 2) * 2, 1, i === 0 ? "#1f4f5c" : "#2f6f80");
      oval(g, 30, 21, 29, 13, "#1f4f5c"); oval(g, 30, 21, 28, 12, "#2f6f80"); oval(g, 22, 14, 13, 4, "#4a8fa0", -4, 0);
      oval(g, 30, 25, 19, 9, "#c9b48a"); oval(g, 30, 25, 18, 8, "#efdfb9"); oval(g, 26, 22, 8, 3, "#fbf0d6", -3, 0);
      R(g, 21, 13, 5, 1, "#143943"); R(g, 34, 13, 5, 1, "#143943"); R(g, 28, 17, 4, 1, "#143943"); // 자는 얼굴
    } },
    // 위 16px 는 음표가 떠오르는 자리
    jukebox: { anim: true, w: 32, h: 64, spots: [[230, 132], [150, 132], [240, 160]], draw(g, t) {
      for (let i = 0; i < 2; i++) {
        const k = (t + i * 5) % 10;
        if (k > 7) continue;
        const nx = 6 + i * 18 + (k % 2), ny = 13 - k;
        R(g, nx, ny - 4, 1, 5, "#ffe066"); R(g, nx - 2, ny, 2, 2, "#ffe066"); R(g, nx, ny - 4, 3, 1, "#ffe066");
      }
      g.save(); g.translate(0, 16);
      oval(g, 16, 15, 16, 15, "#5a1f1f", -15, 0); oval(g, 16, 15, 15, 14, "#b0372f", -14, 0);
      box(g, 0, 15, 32, 31, "#b0372f", "#5a1f1f", "#cf5a4f", "#7e2620");
      const rb = ["#ff6b6b", "#ffd54f", "#7ee081", "#5bc0eb", "#b388ff"];
      rb.forEach((c, i) => oval(g, 16, 16, 12 - i, 11 - i, (i + Math.floor(t / 2)) % 5 === 0 ? "#ffffff" : c, -(11 - i), 0));
      oval(g, 16, 16, 7, 6, "#2a1010", -6, 0);
      R(g, 6, 20, 20, 9, "#2a1a1a"); oval(g, 16, 24, 6, 2, "#111111"); R(g, 15, 24, 3, 1, "#e0a040");
      R(g, 6, 31, 20, 11, "#3b2020"); for (let x = 7; x < 26; x += 2) R(g, x, 32, 1, 9, "#6e2a24");
      R(g, 0, 46, 32, 2, "#3b2020");
      g.restore();
    } },
    arcade: { anim: true, w: 28, h: 56, spots: [[292, 152], [160, 132], [4, 156]], draw(g, t) {
      box(g, 0, 7, 28, 49, "#5b3fa8", "#2a1a5a", "#7d63c9", "#46308a");
      box(g, 2, 0, 24, 10, "#ffd54f", "#8a6a12", "#fff3b0");
      for (let i = 0; i < 4; i++) R(g, 6 + i * 5, 4, 3, 2, t % 2 === i % 2 ? "#e53935" : "#c49000");
      R(g, 3, 12, 22, 18, "#111111"); R(g, 5, 14, 18, 14, "#0b1a3a");
      R(g, 6, 25, 16, 1, "#3d7bff"); R(g, 5 + ((t * 2) % 14), 22, 3, 3, "#ffd54f"); R(g, 18 - ((t * 3) % 10), 17, 2, 2, "#ff5f7a");
      R(g, 7, 15, 3, 1, "#7ee081"); R(g, 11, 15, 2, 1, "#7ee081");
      dither(g, 5, 14, 18, 14, "#00000033");
      R(g, 1, 31, 26, 8, "#3a2878"); R(g, 1, 31, 26, 1, "#8f78dd");
      R(g, 7, 30, 2, 4, "#222222"); oval(g, 8, 29, 2, 2, "#e53935");
      oval(g, 16, 35, 1, 1, "#4fc3f7"); oval(g, 21, 35, 1, 1, "#ffd54f");
      R(g, 11, 43, 6, 5, "#221650"); R(g, 13, 44, 2, 3, t % 2 ? "#ff5252" : "#aa3030");
      R(g, 2, 50, 24, 5, "#2a1a5a");
    } },
    fireplace: { anim: true, w: 66, h: 54, spots: [[112, 132], [34, 158], [186, 158]], draw(g, t) {
      box(g, 0, 0, 66, 7, "#6d4c41", "#3e2723", "#8d6e63", "#4e342e");
      R(g, 3, 7, 60, 47, "#a1453a");
      for (let y = 7, r = 0; y < 54; y += 5, r++) {
        R(g, 3, y, 60, 1, "#7a2f27"); R(g, 3, y + 1, 60, 1, "#b65a4e");
        for (let x = 3 + (r % 2) * 6; x < 63; x += 12) R(g, x, y, 1, 5, "#7a2f27");
      }
      R(g, 14, 20, 38, 34, "#1a0d08"); oval(g, 33, 21, 19, 7, "#1a0d08", -7, 0);
      R(g, 8, 50, 50, 4, "#8d8d8d"); R(g, 8, 50, 50, 1, "#b0b0b0");
      R(g, 20, 46, 26, 3, "#5d4037"); R(g, 23, 44, 10, 2, "#6d4c41"); R(g, 33, 45, 9, 2, "#4e342e");
      const r = seeded(100 + (t % 4));
      for (let i = 0; i < 6; i++) { const h = 8 + Math.floor(r() * 10); oval(g, 22 + i * 4, 46 - h / 2, 3, h / 2, "#ff8f00"); }
      for (let i = 0; i < 4; i++) { const h = 5 + Math.floor(r() * 7); oval(g, 25 + i * 5, 46 - h / 2, 2, h / 2, "#ffd54f"); }
      oval(g, 33, 43, 3, 2, "#fff6d0");
      dither(g, 14, 22, 38, 20, "#ff8f0018");
    } },
    pond: { flat: true, anim: true, w: 78, h: 28, spots: [[200, 194], [92, 194]], draw(g, t) {
      oval(g, 39, 14, 38, 13, "#6b6b6b"); oval(g, 39, 13, 37, 12, "#8a8a8a");
      const r = seeded(4);
      for (let a = 0; a < 360; a += 20) { const rad = (a * Math.PI) / 180; oval(g, Math.round(39 + Math.cos(rad) * 34), Math.round(13 + Math.sin(rad) * 10.5), 3, 2, r() < 0.5 ? "#a3a3a3" : "#767676"); }
      oval(g, 39, 13, 31, 8, "#2f8fbf"); oval(g, 39, 13, 28, 6, "#3fa7d6");
      for (let i = 0; i < 4; i++) R(g, 18 + i * 13 + ((t + i) % 3), 10 + (i % 2) * 5, 5, 1, "#bfe8f7");
      oval(g, 58, 12, 4, 2, "#4caf50"); R(g, 58, 11, 2, 1, "#3fa7d6"); R(g, 56, 11, 1, 1, "#ff8fb1");
      const fx = 24 + ((t >> 1) % 3), fy = 13 - (t % 6 === 0 ? 2 : 0); // 잉어킹 — 가끔 튀어 오른다
      oval(g, fx, fy, 6, 3, "#e8552f"); oval(g, fx, fy - 1, 5, 2, "#ff7043", -2, 0);
      R(g, fx - 9, fy - 2, 3, 5, "#ff7043"); R(g, fx - 8, fy - 1, 1, 3, "#ffb199");
      R(g, fx + 3, fy - 2, 2, 2, "#ffffff"); R(g, fx + 4, fy - 1, 1, 1, "#222222");
      R(g, fx - 2, fy - 5, 4, 2, "#ffd54f"); R(g, fx + 6, fy, 2, 1, "#ffe082");
    } },
    healer: { anim: true, w: 52, h: 44, spots: [[120, 132], [196, 132], [128, 156]], draw(g, t) {
      box(g, 0, 18, 52, 26, "#f5f5f5", "#9e9e9e", "#ffffff", "#e0e0e0");
      R(g, 1, 26, 50, 4, "#e53935"); R(g, 1, 26, 50, 1, "#ff6f60");
      box(g, 4, 10, 44, 10, "#eceff1", "#78909c", "#ffffff");
      for (let i = 0; i < 6; i++) {
        const x = 9 + i * 7, lit = t % 6 === i;
        oval(g, x, 15, 3, 3, "#555555"); oval(g, x, 15, 2, 2, lit ? "#ff8a80" : "#e53935", -2, -1); oval(g, x, 15, 2, 2, lit ? "#ffffff" : "#f0f0f0", 0, 2); R(g, x - 2, 15, 5, 1, "#333333");
      }
      box(g, 17, 0, 18, 11, "#263238", "#111111", "#37474f");
      const hc = t % 2 ? "#7ee081" : "#4caf50";
      R(g, 21, 3, 2, 1, hc); R(g, 25, 3, 2, 1, hc); R(g, 20, 4, 8, 2, hc); R(g, 21, 6, 6, 1, hc); R(g, 22, 7, 4, 1, hc); R(g, 23, 8, 2, 1, hc);
      R(g, 24, 32, 4, 10, "#e53935"); R(g, 21, 35, 10, 4, "#e53935"); R(g, 24, 32, 4, 1, "#ff8a80"); R(g, 21, 35, 3, 1, "#ff8a80");
    } },
    masterball: { anim: true, w: 26, h: 48, spots: [[196, 132], [106, 132], [190, 156], [8, 168]], draw(g, t) {
      box(g, 3, 32, 20, 16, "#5d4037", "#3e2723", "#795548", "#4e342e"); R(g, 1, 30, 24, 3, "#8d6e63"); R(g, 1, 30, 24, 1, "#a1887f");
      R(g, 8, 38, 10, 4, "#c49000"); R(g, 8, 38, 10, 1, "#ffd54f");
      R(g, 3, 4, 20, 26, "#bfe8f733"); R(g, 3, 4, 20, 1, "#9fd3e6"); R(g, 3, 4, 1, 26, "#9fd3e6"); R(g, 22, 4, 1, 26, "#9fd3e6"); R(g, 3, 1, 20, 3, "#7fb7c9");
      const cx = 13, cy = 19;
      oval(g, cx, cy, 7, 7, "#2a1a3a"); oval(g, cx, cy, 6, 6, "#7b3fa0", -6, -1); oval(g, cx, cy, 6, 6, "#f4f4f4", 0, 6);
      oval(g, cx - 3, cy - 3, 1, 1, "#ff5fa8"); oval(g, cx + 3, cy - 3, 1, 1, "#ff5fa8");
      R(g, cx - 1, cy - 4, 1, 3, "#ffffff"); R(g, cx + 1, cy - 4, 1, 3, "#ffffff"); R(g, cx, cy - 3, 1, 1, "#ffffff");
      R(g, cx - 6, cy, 13, 1, "#2a1a3a"); oval(g, cx, cy, 2, 2, "#2a1a3a"); R(g, cx, cy, 1, 1, "#ffffff");
      for (let i = 0; i < 7; i++) R(g, 5 + i, 6 + i * 2, 1, 2, "#ffffff55");
      const sp = [[6, 8], [20, 12], [18, 26], [7, 24]][t % 4];
      R(g, sp[0], sp[1] - 1, 1, 3, "#ffffff"); R(g, sp[0] - 1, sp[1], 3, 1, "#ffffff");
    } },
    // 내가 가진 전설(d.statue)의 그림을 돌 색으로 바꿔 깎는다. 그림이 오기 전 · 전설이 없으면 빈 받침에 돌덩이
    statue: { w: 40, h: 60, spots: [[252, 132], [146, 132], [96, 160]], draw(g, t, k) {
      box(g, 2, 44, 36, 16, "#9e9e9e", "#5f5f5f", "#c4c4c4", "#7d7d7d"); R(g, 0, 42, 40, 3, "#b5b5b5"); R(g, 0, 42, 40, 1, "#d6d6d6");
      R(g, 11, 50, 18, 5, "#c49000"); R(g, 11, 50, 18, 1, "#ffd54f");
      const st = k && k.dexId ? stoneOf(k.dexId) : null;
      if (st) g.drawImage(st, 20 - Math.floor(st.fitW / 2), 43 - st.fitH, st.fitW, st.fitH);
      else { box(g, 12, 18, 16, 25, "#8a8a8a", "#5f5f5f", "#a0a0a0", "#767676"); R(g, 15, 24, 4, 3, "#767676"); }
    } },
  };
  const COIN_ORDER = ["statue", "fireplace", "healer", "arcade", "jukebox", "masterball", "beanbag", "pond", "clock", "neon"];

  /* ================= 코인 가구 SVG — 포켓몬 방. 크기(w, h)는 COIN 그대로 =================
     움직임은 CSS(room.css 의 cf-*)가 맡는다 — 불꽃 · 음표 · 불빛 · 화면 · 잉어킹. 0.25초 타이머는
     시계 바늘 · 석상 그림만 고친다(COIN_TICK). 🦖 디지털 월드는 도트 캔버스(COIN.draw) 그대로 */
  const star5 = (cx, cy, R, r) => Array.from({ length: 10 }, (_, k) => { const a = (k / 10) * Math.PI * 2 - Math.PI / 2, rr = k % 2 ? r : R; return `${k ? "L" : "M"}${(cx + Math.cos(a) * rr).toFixed(2)} ${(cy + Math.sin(a) * rr).toFixed(2)}`; }).join(" ") + " Z";
  const note = (x, y, c, cls) => `<g class="${cls}"><path d="M${x} ${y} V${y - 6} L${x + 3.4} ${y - 7.2} V${y - 1.4}" fill="none" stroke="${c}" stroke-width=".8"/><ellipse cx="${x - 1}" cy="${y}" rx="1.3" ry="1" fill="${c}"/><ellipse cx="${x + 2.4}" cy="${y - 1.2}" rx="1.3" ry="1" fill="${c}"/></g>`;
  const COIN_SVG = {
    clock: (p) => `<defs>
      <radialGradient id="${p}r" cx="35%" cy="25%" r="80%"><stop offset="0" stop-color="#ff8a80"/><stop offset=".5" stop-color="#e53935"/><stop offset="1" stop-color="#a31515"/></radialGradient>
      <linearGradient id="${p}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfd6de"/></linearGradient>
      <radialGradient id="${p}f" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="#efe6d2"/></radialGradient>
      <clipPath id="${p}c"><circle cx="13" cy="13" r="12"/></clipPath></defs>
      <circle cx="13.6" cy="13.8" r="12.4" fill="#000" opacity=".2"/>
      <g clip-path="url(#${p}c)"><rect width="26" height="13" fill="url(#${p}r)"/><rect y="13" width="26" height="13" fill="url(#${p}w)"/><rect y="11.8" width="26" height="2.4" fill="#2a2020"/></g>
      <circle cx="13" cy="13" r="12" fill="none" stroke="#2a2020" stroke-width=".9"/>
      <circle cx="13" cy="13" r="8.4" fill="#2a2020"/><circle cx="13" cy="13" r="7.6" fill="url(#${p}f)"/>
      ${Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2, q = i % 3 === 0; return `<line x1="${(13 + Math.sin(a) * (q ? 5.4 : 6.1)).toFixed(2)}" y1="${(13 - Math.cos(a) * (q ? 5.4 : 6.1)).toFixed(2)}" x2="${(13 + Math.sin(a) * 6.8).toFixed(2)}" y2="${(13 - Math.cos(a) * 6.8).toFixed(2)}" stroke="${q ? "#5d4037" : "#b0a090"}" stroke-width="${q ? .8 : .45}" stroke-linecap="round"/>`; }).join("")}
      <line class="cl-h" x1="13" y1="13.8" x2="13" y2="9" stroke="#e53935" stroke-width="1.2" stroke-linecap="round"/>
      <line class="cl-m" x1="13" y1="14.4" x2="13" y2="7.2" stroke="#1b1b1b" stroke-width=".8" stroke-linecap="round"/>
      <circle cx="13" cy="13" r="1.1" fill="#1b1b1b"/><circle cx="13" cy="13" r=".45" fill="#fafafa"/>
      <ellipse cx="8.4" cy="4.6" rx="3.6" ry="1.4" fill="#fff" opacity=".5" transform="rotate(-25 8.4 4.6)"/>`,
    neon: (p) => `<defs>
      <filter id="${p}g" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation=".9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <linearGradient id="${p}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2148"/><stop offset="1" stop-color="#120d24"/></linearGradient></defs>
      <rect x=".3" y=".3" width="49.4" height="19.4" rx="2" fill="url(#${p}b)" stroke="#0d0a1a" stroke-width=".6"/>
      <rect x="1.2" y="1.2" width="47.6" height="17.6" rx="1.4" fill="none" stroke="#4a3a7a" stroke-width=".4"/>
      <g class="cf-neon" filter="url(#${p}g)">
        <path d="M8 15 C2.6 11.4 3 6.6 5.8 6.4 C7 6.3 7.8 7.2 8 8.2 C8.2 7.2 9 6.3 10.2 6.4 C13 6.6 13.4 11.4 8 15 Z" fill="none" stroke="#ff6fb0" stroke-width="1.1" stroke-linejoin="round"/>
        <text x="31" y="14" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="9.4" letter-spacing=".6" fill="none" stroke="#7ff3ff" stroke-width=".8">POKE</text>
      </g>
      ${[[3, 3], [47, 3], [3, 17], [47, 17]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".55" fill="#6a5a9a"/>`).join("")}`,
    beanbag: (p) => `<defs>
      <radialGradient id="${p}b" cx="40%" cy="30%" r="75%"><stop offset="0" stop-color="#5fa8ba"/><stop offset=".6" stop-color="#2f6f80"/><stop offset="1" stop-color="#1c4652"/></radialGradient>
      <radialGradient id="${p}c" cx="45%" cy="35%" r="70%"><stop offset="0" stop-color="#fff8e6"/><stop offset="1" stop-color="#e2cf9f"/></radialGradient></defs>
      <ellipse cx="30" cy="33.6" rx="27" ry="2.2" fill="#000" opacity=".22"/>
      <path d="M9.4 9.6 L13 2.4 L16.6 9 Z M43.4 9 L47 2.4 L50.6 9.6 Z" fill="#2f6f80" stroke="#1c4652" stroke-width=".5" stroke-linejoin="round"/>
      <path d="M11.6 8 L13 4.8 L14.4 7.8 Z M45.6 7.8 L47 4.8 L48.4 8 Z" fill="#5fa8ba"/>
      <ellipse cx="30" cy="21" rx="29" ry="13" fill="url(#${p}b)" stroke="#1c4652" stroke-width=".6"/>
      <ellipse cx="30" cy="25.4" rx="18.4" ry="8.4" fill="url(#${p}c)" stroke="#c9b48a" stroke-width=".5"/>
      <path d="M21.6 13.6 Q23.6 15 25.6 13.6 M34.4 13.6 Q36.4 15 38.4 13.6" fill="none" stroke="#143943" stroke-width=".8" stroke-linecap="round"/>
      <path d="M28 17.6 Q30 18.6 32 17.6" fill="none" stroke="#143943" stroke-width=".7" stroke-linecap="round"/>
      <ellipse cx="19" cy="12" rx="6" ry="2" fill="#fff" opacity=".18" transform="rotate(-15 19 12)"/>
      <text class="cf-zz" x="44" y="10" font-family="Arial, sans-serif" font-weight="900" font-size="5" fill="#e3f2fd">z</text>
      <text class="cf-zz b" x="47.4" y="6.6" font-family="Arial, sans-serif" font-weight="900" font-size="3.6" fill="#e3f2fd">z</text>`,
    jukebox: (p) => `<defs>
      <linearGradient id="${p}b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7e2620"/><stop offset=".3" stop-color="#cf5a4f"/><stop offset=".65" stop-color="#b0372f"/><stop offset="1" stop-color="#5a1f1f"/></linearGradient>
      <linearGradient id="${p}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b2020"/><stop offset="1" stop-color="#1e0e0e"/></linearGradient></defs>
      ${note(8, 14, "#ffe066", "cf-note")}${note(22, 14, "#ffb3d9", "cf-note b")}
      <ellipse cx="16" cy="63.4" rx="15" ry=".8" fill="#000" opacity=".25"/>
      <path d="M.4 63 V31 A15.6 15 0 0 1 31.6 31 V63 Z" fill="url(#${p}b)" stroke="#5a1f1f" stroke-width=".6"/>
      ${["#ff6b6b", "#ffd54f", "#7ee081", "#5bc0eb", "#b388ff"].map((c, i) => `<path class="cf-arc" style="animation-delay:${(-i * .3).toFixed(1)}s" d="M${4 + i} 32 A${12 - i} ${11.4 - i} 0 0 1 ${28 - i} 32" fill="none" stroke="${c}" stroke-width=".95"/>`).join("")}
      <path d="M9 32 A7 6.4 0 0 1 23 32 Z" fill="#2a1010"/>
      <rect x="5.6" y="35.4" width="20.8" height="10" rx="1" fill="#2a1a1a" stroke="#120808" stroke-width=".4"/>
      <ellipse cx="16" cy="40.4" rx="6.4" ry="2.2" fill="#111"/><ellipse class="cf-spin" cx="16" cy="40.4" rx="6.4" ry="2.2" fill="none" stroke="#444" stroke-width=".3" stroke-dasharray="1 1.2"/><circle cx="16" cy="40.4" r=".9" fill="#e0a040"/>
      <rect x="6" y="47.4" width="20" height="11" rx=".8" fill="url(#${p}g)"/>
      ${Array.from({ length: 9 }, (_, i) => `<rect x="${7.2 + i * 2.1}" y="48.4" width="1.1" height="9" rx=".5" fill="#6e2a24"/>`).join("")}
      <rect x=".4" y="60.4" width="31.2" height="2.6" rx=".6" fill="#3b2020"/><rect x="1" y="31" width="1.4" height="29" fill="#fff" opacity=".18"/>`,
    arcade: (p) => `<defs>
      <linearGradient id="${p}b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#46308a"/><stop offset=".3" stop-color="#8f78dd"/><stop offset=".6" stop-color="#5b3fa8"/><stop offset="1" stop-color="#2a1a5a"/></linearGradient>
      <linearGradient id="${p}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset="1" stop-color="#e0a800"/></linearGradient>
      <linearGradient id="${p}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16285a"/><stop offset="1" stop-color="#070f24"/></linearGradient>
      <clipPath id="${p}c"><rect x="5" y="13.6" width="18" height="14.4" rx="1"/></clipPath></defs>
      <ellipse cx="14" cy="55.6" rx="13" ry=".9" fill="#000" opacity=".25"/>
      <path d="M.4 55.6 V9 L2 7 H26 L27.6 9 V55.6 Z" fill="url(#${p}b)" stroke="#2a1a5a" stroke-width=".6"/>
      <rect x="2" y=".4" width="24" height="9.4" rx="1.2" fill="url(#${p}m)" stroke="#8a6a12" stroke-width=".5"/>
      ${[0, 1, 2, 3].map((i) => `<circle class="cf-blink${i % 2 ? " b" : ""}" cx="${7 + i * 5}" cy="5.1" r="1.4" fill="#e53935"/>`).join("")}
      <rect x="3" y="11.6" width="22" height="18.4" rx="1.4" fill="#111"/>
      <g clip-path="url(#${p}c)">
        <rect x="5" y="13.6" width="18" height="14.4" fill="url(#${p}s)"/>
        ${[[8, 17], [17, 15.4], [12, 19.6], [20, 21.4], [6.4, 23]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".3" fill="#fff" opacity=".7"/>`).join("")}
        <rect x="5" y="25.4" width="18" height=".8" fill="#3d7bff"/>
        <g class="cf-run"><circle cx="8" cy="23.6" r="1.6" fill="#ffd54f"/><path d="M8 23.6 L9.8 22.6 V24.6 Z" fill="#16285a"/></g>
        <g class="cf-ufo"><ellipse cx="18" cy="17.4" rx="1.8" ry=".9" fill="#ff5f7a"/><ellipse cx="18" cy="16.8" rx=".9" ry=".7" fill="#ffd1dc"/></g>
        <text x="6.4" y="16" font-family="Consolas, monospace" font-size="2" font-weight="700" fill="#7ee081">1UP 2400</text>
      </g>
      <path d="M5 13.6 L13 13.6 L7 28 H5 Z" fill="#fff" opacity=".06"/>
      <path d="M.8 31 H27.2 L26.4 39 H1.6 Z" fill="#3a2878" stroke="#21165a" stroke-width=".4"/><rect x="1" y="31" width="26" height=".7" fill="#8f78dd"/>
      <rect x="7.4" y="31" width="1.2" height="3.4" fill="#222"/><circle cx="8" cy="30.6" r="1.6" fill="#e53935"/><circle cx="7.5" cy="30.1" r=".5" fill="#ff8a80"/>
      <circle cx="16" cy="35" r="1.2" fill="#4fc3f7" stroke="#0277bd" stroke-width=".3"/><circle cx="20.6" cy="35" r="1.2" fill="#ffd54f" stroke="#a87400" stroke-width=".3"/>
      <rect x="10.6" y="42.4" width="6.8" height="5.6" rx=".6" fill="#221650"/><rect class="cf-blink" x="13.2" y="43.4" width="1.6" height="3.4" rx=".4" fill="#ff5252"/>
      <rect x="2" y="50" width="24" height="5" rx=".6" fill="#2a1a5a"/>`,
    fireplace: (p) => `<defs>
      <pattern id="${p}k" width="12" height="5" patternUnits="userSpaceOnUse"><rect width="12" height="5" fill="#a1453a"/><rect width="12" height=".8" fill="#7a2f27"/><rect y=".8" width="12" height=".6" fill="#b65a4e"/><rect x="0" width=".7" height="2.6" fill="#7a2f27"/><rect x="6" y="2.5" width=".7" height="2.5" fill="#7a2f27"/><rect y="2.5" width="12" height=".6" fill="#7a2f27"/></pattern>
      ${WOOD(p + "w", "#a1887f", "#6d4c41", "#3e2723")}
      <radialGradient id="${p}g" cx="50%" cy="85%" r="65%"><stop offset="0" stop-color="#ffb74d" stop-opacity=".75"/><stop offset="1" stop-color="#ff6f00" stop-opacity="0"/></radialGradient>
      <linearGradient id="${p}f" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff6f00"/><stop offset=".6" stop-color="#ffa726"/><stop offset="1" stop-color="#ffd54f"/></linearGradient>
      <linearGradient id="${p}y" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ffd54f"/><stop offset="1" stop-color="#fff6d0"/></linearGradient></defs>
      <rect x="3" y="6" width="60" height="48" fill="url(#${p}k)" stroke="#5a2018" stroke-width=".4"/>
      <path d="M14 54 V24 A19 9 0 0 1 52 24 V54 Z" fill="#c8a07a" stroke="#6d4c41" stroke-width=".5"/>
      <path d="M16 54 V25 A17 7.6 0 0 1 50 25 V54 Z" fill="#1a0d08"/>
      <rect class="cf-glow" x="16" y="20" width="34" height="34" fill="url(#${p}g)"/>
      <path class="cf-fire" d="M21 47 C20 41 24 39 23 33 C27 36 26 40 28 41 C28 36 31 33 31 28 C35 33 36 37 35 41 C37 39 38 36 38 34 C42 38 44 42 42 47 Z" fill="url(#${p}f)"/>
      <path class="cf-fire b" d="M26 47 C25.4 43 28 41 28 37.6 C30.6 40 31.4 42.6 33 43 C33 40.6 35 39 35.6 37.2 C38.4 40.4 39.4 44 38 47 Z" fill="url(#${p}y)"/>
      <rect x="19" y="45.2" width="28" height="3" rx="1.4" fill="#5d4037" transform="rotate(-4 33 46.7)"/><rect x="22" y="46" width="24" height="2.6" rx="1.3" fill="#4e342e" transform="rotate(5 34 47.3)"/>
      <rect x="8" y="50" width="50" height="4" rx=".6" fill="#8d8d8d"/><rect x="8" y="50" width="50" height=".9" fill="#c4c4c4"/>
      <rect x="0" y="0" width="66" height="7" rx="1" fill="url(#${p}w)" stroke="#3e2723" stroke-width=".5"/><rect x=".6" y=".4" width="64.8" height=".9" fill="#bca093"/>
      <rect x="2" y="7" width="62" height="1.2" fill="#000" opacity=".25"/>`,
    pond: (p) => `<defs>
      <radialGradient id="${p}w" cx="50%" cy="35%" r="65%"><stop offset="0" stop-color="#6fd0f5"/><stop offset=".7" stop-color="#3fa7d6"/><stop offset="1" stop-color="#1f6f9a"/></radialGradient>
      <clipPath id="${p}c"><ellipse cx="39" cy="13" rx="31" ry="8.2"/></clipPath></defs>
      <ellipse cx="39" cy="15" rx="38" ry="12.6" fill="#000" opacity=".18"/>
      <ellipse cx="39" cy="13.4" rx="37.4" ry="12.2" fill="#8a8a8a"/>
      ${Array.from({ length: 18 }, (_, i) => { const a = (i / 18) * Math.PI * 2, x = 39 + Math.cos(a) * 34, y = 13.4 + Math.sin(a) * 10.4; return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="3.6" ry="2.4" fill="${i % 3 ? "#9e9e9e" : "#7a7a7a"}" stroke="#5f5f5f" stroke-width=".35"/><ellipse cx="${(x - .8).toFixed(1)}" cy="${(y - .8).toFixed(1)}" rx="1.4" ry=".7" fill="#d6d6d6" opacity=".7"/>`; }).join("")}
      <ellipse cx="39" cy="13" rx="31" ry="8.2" fill="url(#${p}w)" stroke="#2f6f8f" stroke-width=".4"/>
      <g clip-path="url(#${p}c)">
        ${[[22, 11], [46, 16], [33, 9]].map(([x, y], i) => `<ellipse class="cf-ripple" style="animation-delay:${-i * 1.1}s" cx="${x}" cy="${y}" rx="4" ry="1.2" fill="none" stroke="#e1f5fe" stroke-width=".45"/>`).join("")}
        <g class="cf-karp">
          <path d="M18 13 C20 10 27 9.6 30 12.4 C27 15.6 20 15.4 18 13 Z" fill="#ff7043" stroke="#c43e1a" stroke-width=".35"/>
          <path d="M18.6 13 L14.6 10.4 L15.6 13 L14.6 15.6 Z" fill="#ffb199" stroke="#c43e1a" stroke-width=".3"/>
          <path d="M22 10.4 L23.6 7.8 L25.6 10.2 Z" fill="#ffd54f"/>
          <path d="M23.4 14.6 L24.4 16.6 L25.8 14.8 Z" fill="#ffe082"/>
          <circle cx="27.6" cy="12" r=".9" fill="#fff"/><circle cx="27.8" cy="12" r=".4" fill="#222"/>
          <path d="M29.6 12.8 Q31.4 13.8 30.4 15" fill="none" stroke="#ffe082" stroke-width=".4"/>
        </g>
        <path d="M4 9 Q39 3 74 9" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width=".8"/>
      </g>
      <path d="M58 12 A4.2 2.4 0 1 1 61.6 10.8 L58 12 Z" fill="#4caf50" stroke="#2e7d32" stroke-width=".35"/>
      <circle cx="56.6" cy="11.4" r="1.2" fill="#ff8fb1"/><circle cx="56.6" cy="11.4" r=".5" fill="#fff59d"/>`,
    healer: (p) => `<defs>
      <linearGradient id="${p}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d6d6d6"/></linearGradient>
      <linearGradient id="${p}r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6f60"/><stop offset="1" stop-color="#c62828"/></linearGradient>
      <linearGradient id="${p}t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5f7f8"/><stop offset="1" stop-color="#b0bec5"/></linearGradient></defs>
      <ellipse cx="26" cy="43.6" rx="25" ry=".9" fill="#000" opacity=".22"/>
      <rect x=".3" y="18" width="51.4" height="25.6" rx="1.6" fill="url(#${p}b)" stroke="#9e9e9e" stroke-width=".5"/>
      <rect x=".8" y="25.6" width="50.4" height="4.4" fill="url(#${p}r)"/><rect x=".8" y="25.6" width="50.4" height=".7" fill="#ff8a80"/>
      <path d="M24 32 H28 V35 H31 V39 H28 V42 H24 V39 H21 V35 H24 Z" fill="url(#${p}r)" stroke="#a31515" stroke-width=".3"/>
      <rect x="4" y="10" width="44" height="10" rx="1.4" fill="url(#${p}t)" stroke="#78909c" stroke-width=".45"/>
      ${Array.from({ length: 6 }, (_, i) => { const x = 9 + i * 7; return `<g class="cf-ball" style="animation-delay:${(i * .25).toFixed(2)}s"><circle cx="${x}" cy="15" r="2.8" fill="#555"/><path d="M${x - 2.3} 15 A2.3 2.3 0 0 1 ${x + 2.3} 15 Z" fill="#e53935"/><path d="M${x - 2.3} 15 A2.3 2.3 0 0 0 ${x + 2.3} 15 Z" fill="#f4f4f4"/><rect x="${x - 2.3}" y="14.7" width="4.6" height=".6" fill="#333"/><circle cx="${x}" cy="15" r=".7" fill="#fff" stroke="#333" stroke-width=".3"/></g>`; }).join("")}
      <rect x="17" y=".3" width="18" height="10.6" rx="1.2" fill="#263238" stroke="#111" stroke-width=".5"/>
      <rect x="18.4" y="1.6" width="15.2" height="8" rx=".6" fill="#0f1d14"/>
      <path class="cf-heart" d="M26 8.6 C22.6 6.4 22.4 3.6 24.2 3.4 C25 3.3 25.7 3.9 26 4.6 C26.3 3.9 27 3.3 27.8 3.4 C29.6 3.6 29.4 6.4 26 8.6 Z" fill="#7ee081"/>
      <path d="M18.4 6 H21 L21.8 4.4 L22.6 7.4 L23.2 6 H24" fill="none" stroke="#4caf50" stroke-width=".35" opacity=".8"/>`,
    masterball: (p) => `<defs>${WOOD(p + "w", "#8d6e63", "#5d4037", "#3e2723")}
      <radialGradient id="${p}u" cx="40%" cy="25%" r="80%"><stop offset="0" stop-color="#b47ad6"/><stop offset=".6" stop-color="#7b3fa0"/><stop offset="1" stop-color="#4a1f66"/></radialGradient>
      <linearGradient id="${p}g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e1f5fe" stop-opacity=".35"/><stop offset=".5" stop-color="#b3e5fc" stop-opacity=".12"/><stop offset="1" stop-color="#e1f5fe" stop-opacity=".3"/></linearGradient></defs>
      <ellipse cx="13" cy="47.6" rx="12" ry=".8" fill="#000" opacity=".25"/>
      <rect x="3" y="32" width="20" height="16" rx=".8" fill="url(#${p}w)" stroke="#3e2723" stroke-width=".45"/>
      <rect x="1" y="29.6" width="24" height="3.2" rx=".8" fill="#8d6e63" stroke="#4e342e" stroke-width=".4"/><rect x="1.4" y="29.8" width="23.2" height=".7" fill="#bca093"/>
      <rect x="7.6" y="37.6" width="10.8" height="4.4" rx=".5" fill="#c49000"/><rect x="8.2" y="38.2" width="9.6" height="3.2" rx=".4" fill="#ffd54f"/><rect x="9.6" y="39.4" width="6.8" height=".7" fill="#a87400"/>
      <circle cx="13" cy="20" r="6.8" fill="#000" opacity=".2"/>
      <path d="M6.4 19 A6.6 6.6 0 0 1 19.6 19 Z" fill="url(#${p}u)"/>
      <path d="M6.4 19 A6.6 6.6 0 0 0 19.6 19 Z" fill="#f4f4f4"/>
      <circle cx="9.6" cy="15.4" r="1.4" fill="#ff5fa8"/><circle cx="16.4" cy="15.4" r="1.4" fill="#ff5fa8"/>
      <path d="M11 17.4 V13.6 L13 15.8 L15 13.6 V17.4" fill="none" stroke="#fff" stroke-width=".7" stroke-linejoin="round"/>
      <rect x="6.4" y="18.5" width="13.2" height="1" fill="#2a1a3a"/><circle cx="13" cy="19" r="6.6" fill="none" stroke="#2a1a3a" stroke-width=".6"/>
      <circle cx="13" cy="19" r="2" fill="#2a1a3a"/><circle cx="13" cy="19" r="1.2" fill="#fafafa"/>
      <rect x="3" y="3.6" width="20" height="26" fill="url(#${p}g)" stroke="#9fd3e6" stroke-width=".5"/>
      <path d="M5 6 L9 6 L5 16 Z" fill="#fff" opacity=".35"/>
      <rect x="2.4" y="1" width="21.2" height="3" rx=".6" fill="#7fb7c9" stroke="#4f8ea3" stroke-width=".4"/>
      <path class="cf-spark" transform="translate(6 8)" d="M0 -2 L.5 -.5 L2 0 L.5 .5 L0 2 L-.5 .5 L-2 0 L-.5 -.5 Z" fill="#fff"/>`,
    statue: (p) => `<defs>
      <linearGradient id="${p}s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d6d6d6"/><stop offset=".5" stop-color="#9e9e9e"/><stop offset="1" stop-color="#6f6f6f"/></linearGradient></defs>
      <ellipse cx="20" cy="59.6" rx="19" ry=".9" fill="#000" opacity=".25"/>
      <rect x="2" y="44" width="36" height="16" rx=".8" fill="url(#${p}s)" stroke="#5f5f5f" stroke-width=".5"/>
      <rect x="0" y="41.6" width="40" height="3.4" rx=".8" fill="#bdbdbd" stroke="#7d7d7d" stroke-width=".4"/><rect x=".4" y="41.8" width="39.2" height=".8" fill="#e6e6e6"/>
      <rect x="4" y="56.4" width="32" height="1" fill="#000" opacity=".15"/>
      <rect x="11" y="49.6" width="18" height="5.4" rx=".6" fill="#c49000"/><rect x="11.6" y="50.2" width="16.8" height="4.2" rx=".4" fill="#ffd54f"/><rect x="14" y="51.9" width="12" height=".8" fill="#a87400"/>
      <g class="st-rock"><path d="M13 43 L12.4 24 Q12.4 18 16 17 L24 17 Q27.6 18 27.6 24 L27 43 Z" fill="#8a8a8a" stroke="#5f5f5f" stroke-width=".5"/><path d="M15 24 L19 23 L18 27 Z" fill="#767676"/></g>
      <image class="st-img" x="0" y="0" width="0" height="0"/>`,
  };
  /** 0.25초마다 — 시계 바늘은 지금 시각, 석상은 돌 그림이 오면 끼운다 */
  const COIN_TICK = {
    clock(k) {
      const d = new Date(), h = ((d.getHours() % 12) + d.getMinutes() / 60) * 30, m = d.getMinutes() * 6 + d.getSeconds() * 0.1;
      k.svg.querySelector(".cl-h").setAttribute("transform", `rotate(${h.toFixed(1)} 13 13)`);
      k.svg.querySelector(".cl-m").setAttribute("transform", `rotate(${m.toFixed(1)} 13 13)`);
    },
    statue(k) {
      const st = k.dexId ? stoneOf(k.dexId) : null;
      const im = k.svg.querySelector(".st-img");
      if (!st || im.dataset.dex === String(k.dexId)) return;
      im.dataset.dex = String(k.dexId);
      im.setAttribute("href", st.toDataURL());
      im.setAttribute("x", 20 - st.fitW / 2); im.setAttribute("y", (Number(im.dataset.base) || 43) - st.fitH); // 방 석상은 받침 위 43, 홀 마스코트는 53
      im.setAttribute("width", st.fitW); im.setAttribute("height", st.fitH); // 원본 크기 돌 그림을 매끄럽게 줄여 그린다
      k.svg.querySelector(".st-rock").style.display = "none";
    },
  };

  /** 전설 석상 — 스프라이트를 돌 색 4단계로. 그림은 메인이 data: 주소로 준다(캔버스로 읽으려고) */
  const stones = new Map(); // dexId → 캔버스 | 불러오는 중(Promise) | null
  function stoneOf(dexId) {
    const v = stones.get(dexId);
    if (v instanceof HTMLCanvasElement) return v;
    if (v === undefined) {
      stones.set(dexId, (async () => {
        const src = await window.ptb.statueImage(dexId).catch(() => null);
        const img = src && (await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; }));
        stones.set(dexId, img ? toStone(img, 42) : null);
        for (const Rm of rooms) for (const k of Rm.coin || []) if (k.id === "statue") drawCoin(k, frame);
      })());
    }
    return null;
  }
  /**
   * 스프라이트 → 깎은 돌. 원본 크기 그대로(줄이지 않는다) 돌빛으로 칠하고, 왼쪽 위에서 빛이 드는 것처럼
   * 가장자리 · 굴곡을 밝게/어둡게 새긴 뒤 아주 옅은 돌결을 얹는다. 그리는 쪽이 fitW × fitH 로 매끄럽게 줄인다.
   * 예전엔 42px 로 줄여 4단계 회색 도트로 찍어서, 매끈한 받침 위에 거친 덩어리처럼 보였다
   */
  function toStone(img, maxH) {
    const W0 = img.naturalWidth, H0 = img.naturalHeight;
    const [, g] = canvas(W0, H0);
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, W0, H0).data;
    let x0 = W0, y0 = H0, x1 = 0, y1 = 0;
    for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) if (d[(y * W0 + x) * 4 + 3] > 40) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (x1 < x0) return null;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, s = Math.min(1, maxH / bh, 38 / bw);
    const at = (x, y) => (x < x0 || y < y0 || x > x1 || y > y1 ? -1 : (y * W0 + x) * 4);
    const solid = (x, y) => { const i = at(x, y); return i >= 0 && d[i + 3] > 40; };
    const lumOf = (x, y) => { const i = at(x, y); return i < 0 || d[i + 3] <= 40 ? 0 : (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255; };
    const [o, og] = canvas(bw, bh);
    const px = og.createImageData(bw, bh);
    const DARK = [72, 72, 80], LIGHT = [232, 229, 220]; // 서늘한 짙은 돌 → 따뜻한 밝은 돌
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!solid(x, y)) continue;
      const l = lumOf(x, y);
      let t = 0.38 + l * 0.42; // 원래 색의 밝기는 줄여서 — 돌은 한 빛깔이다
      t += (l - lumOf(x - 1, y - 1)) * 0.3; // 굴곡: 왼쪽 위보다 밝으면 볼록
      if (!solid(x - 1, y) || !solid(x, y - 1)) t += 0.16; // 빛 받는 가장자리
      if (!solid(x + 1, y) || !solid(x, y + 1)) t -= 0.2; // 그늘진 가장자리
      t += (((x * 73856093) ^ (y * 19349663)) % 7) / 7 * 0.05 - 0.025; // 돌결
      t = Math.max(0, Math.min(1, t));
      const j = ((y - y0) * bw + (x - x0)) * 4;
      for (let c = 0; c < 3; c++) px.data[j + c] = Math.round(DARK[c] + (LIGHT[c] - DARK[c]) * t);
      px.data[j + 3] = 255;
    }
    og.putImageData(px, 0, 0);
    o.fitW = Math.max(1, Math.round(bw * s)); o.fitH = Math.max(1, Math.round(bh * s)); // 받침 위에 설 크기
    return o;
  }

  /** 코인 가구를 놓을 자리 — 이미 놓인 사탕 가구 · 벽 장식과 겹치지 않는 후보부터. → { id: [x, y, w, h] } */
  const rectArea = (a, b) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  /** 벽 장식이 차지한 자리 — [x, y, w, h]. 코인 가구 자리 고르기와 주크박스 음표(hushJukebox)가 같이 본다 */
  function wallDeco(on, d) {
    const wall = [[100, 24, 32, 26]]; // 도감 액자는 늘 있다
    if (on.has("window")) wall.push([20, 19, 76, 63]);
    if (d.wins > 0) wall.push([DUB.x, DUB.y, DUB.w, DUB.h + 6]); // 아래 "N승" 글자까지
    if (on.has("poster")) wall.push([195, 17, 28, 38]);
    if (d.graduated > 0 || d.champ > 0) wall.push([232, 22, 84, 44]); // 기록 선반 — 쌓인 졸업장(오른쪽 위로 비켜 쌓인다) · 트로피 위 "×N" 까지
    if (d.weekTop > 0) wall.push([100, 56, 32, 40]); // 아래 호봉 띠까지
    if (d.badges > 0) wall.push([GYB.x, GYB.y, GYB.w, GYB.h + 8]); // 아래 "배지" 글자까지
    return wall;
  }
  /**
   * 🎵 주크박스 위로 떠오르는 음표가 벽 장식(체육관 배지 진열장 · 기록 선반 …) 위를 지나가면 끈다.
   * 자리가 모자라면 주크박스가 진열장 바로 아래에 서는데, 그때 음표가 배지 위에서 피어올라 지저분했다
   */
  function hushJukebox(pl, on, d) {
    if (!pl.jukebox) return false;
    const [x, y] = pl.jukebox;
    const notes = [x + 2, y, 28, 18]; // 위 16px 가 음표 자리(COIN.jukebox) — 조금 넉넉히
    return wallDeco(on, d).some((w) => rectArea(notes, w) > 0);
  }

  function placeCoin(on, d, posOf) {
    const area = rectArea;
    const wall = wallDeco(on, d);
    const floor = [...on].filter((id) => FURN[id]).map((id) => [...posOf(id, FURN[id]), FURN[id].w, FURN[id].h]);
    const out = {};
    for (const id of COIN_ORDER) {
      if (!on.has(id)) continue;
      const f = COIN[id];
      // 키 큰 바닥 가구(벽난로 · 석상)가 벽 장식을 가리지 않게 벽 장식도 본다
      const pool = [...wall, ...floor];
      if (d.pos && d.pos[id]) { // 끌어 옮긴 자리
        out[id] = [d.pos[id][0], d.pos[id][1], f.w, f.h];
        (f.wall ? wall : floor).push(out[id]);
        continue;
      }
      const cands = f.spots.map(([x, v]) => (f.wall ? [x, v, f.w, f.h] : [x, v - f.h, f.w, f.h]));
      const cost = (c) => pool.reduce((n, b) => n + area(c, b), 0);
      const best = cands.find((c) => cost(c) === 0) || cands.reduce((a, c) => (cost(c) < cost(a) ? c : a));
      (f.wall ? wall : floor).push(best);
      out[id] = best;
    }
    return out;
  }

  /** 코인 가구 앞에서 포켓몬이 설 자리(방의 %). face 1 = 왼쪽을 본다 */
  function coinSpots(pl) {
    const cx = (v) => Math.max(WALK.x0, Math.min(WALK.x1, X(v)));
    const cy = (v) => Math.max(WALK.y0, Math.min(WALK.y1, Y(v)));
    const s = {};
    const at = (id, fn) => { if (pl[id]) { const [x, y, w, h] = pl[id]; s[id] = fn(x, y, w, h); } };
    at("beanbag", (x, y, w, h) => ({ x: X(x + w / 2), y: Y(y + h - 12), z: (y + h) * 10 + 5 }));
    at("jukebox", (x, y, w, h) => ({ x: cx(x + w + 10), y: cy(y + h + 4), face: 1 }));
    at("arcade", (x, y, w, h) => ({ x: cx(x - 9), y: cy(y + h + 2), face: -1 }));
    if (pl.arcade) { const [x, y, w, h] = pl.arcade; s.arcade2 = { x: cx(x + w + 9), y: cy(y + h + 2), face: 1 }; }
    at("fireplace", (x, y, w, h) => ({ x: cx(x + w / 2), y: cy(y + h + 8), spread: 3 }));
    at("pond", (x, y, w, h) => ({ x: cx(x + 6), alt: cx(x + w - 6), y: cy(y + h - 6), cx: X(x + w / 2) }));
    at("healer", (x, y, w, h) => ({ x: cx(x + w + 8), y: cy(y + h + 3), face: 1 }));
    at("statue", (x, y, w, h) => ({ x: cx(x - 8), alt: cx(x + w + 8), y: cy(y + h + 5), cx: X(x + w / 2) }));
    at("masterball", (x, y, w, h) => ({ x: cx(x + w + 7), y: cy(y + h + 4), face: 1 }));
    return s;
  }

  /** 사탕 가구 앞에서 포켓몬이 설 자리 — 가구를 옮기면 따라간다. z 는 앉거나 누울 때 앞뒤 */
  function candySpots(posOf) {
    const cx = (v) => Math.max(WALK.x0, Math.min(WALK.x1, X(v)));
    const cy = (v) => Math.max(WALK.y0, Math.min(WALK.y1, Y(v)));
    const [px, py] = posOf("plant", FURN.plant), [qx, qy] = posOf("cushion", FURN.cushion), [bx, by] = posOf("bed", FURN.bed), [tx, ty] = posOf("tv", FURN.tv);
    return {
      plant: { x: cx(px - 12), y: cy(py + 40), face: -1 }, // 화분 왼쪽에서 오른쪽을 본다
      cushion: { x: X(qx + 14), y: Y(qy + 6), z: (qy + FURN.cushion.h) * 10 + 10 },
      bed: { x: X(bx + 38), y: Y(by + 19), z: (by + FURN.bed.h) * 10 + 5, walkY: cy(by + FURN.bed.h + 4) },
      tv: { x: cx(tx + 20), y: cy(ty + 56), face: 1 },
      fountain: SPOT.fountain,
    };
  }

  function drawCoin(k, t) {
    if (k.svg) return void (COIN_TICK[k.id] && COIN_TICK[k.id](k, t)); // 포켓몬 방의 SVG 코인 가구 — 움직임은 CSS
    k.g.clearRect(0, 0, k.f.w, k.f.h);
    k.f.draw(k.g, t, k);
  }
  // 움직이는 코인 가구 — 보이는 방만 0.25초마다 다시 그린다
  let frame = 0;
  setInterval(() => {
    frame++;
    for (const Rm of rooms) {
      if (!Rm.coin || !Rm.coin.length || !Rm.el.offsetParent) continue;
      for (const k of Rm.coin) if (k.f.anim) drawCoin(k, frame);
    }
  }, 250);

  /* ================= 방 하나 =================
     내 방과 길드원의 방이 같은 코드로 그려진다. 그릴 거리(data)는 이런 꼴이다:
       { theme, furni: [놓은 가구 id], mons: [{ id, name, url, animUrl, stageKey, shiny, profile, active }],
         dex: { seen, total }, wins, graduated, lastGrad, trainer } */

  const SIZE = { baby: 10.5, mid: 12.5, final: 15, master: 15 }; // 방 너비의 %
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function create(el) {
    if (!el.querySelector(".rm-scene")) {
      el.insertAdjacentHTML("beforeend", '<div class="rm-scene"></div><div class="rm-actors"></div><div class="rm-empty" hidden>방에 둔 포켓몬이 없습니다</div>');
    }
    const Rm = { el, key: "", scene: null, actors: new Map(), data: null, coin: [] };
    rooms.add(Rm);
    return {
      render: (d) => render(Rm, d),
      setEmpty: (text) => (el.querySelector(".rm-empty").textContent = text),
    };
  }

  function render(Rm, d) {
    Rm.data = d;
    const key = JSON.stringify([d.kind, d.code, d.guildName, d.count, d.notice, d.hall, d.goal && [d.goal.total, d.goal.tiers], d.weekTop, d.badges, d.champ, d.theme, d.furni, d.statue, d.pos, d.dex && d.dex.seen, d.dex && d.dex.total, d.wins, d.graduated, d.lastGrad, d.trainer, period(d.theme)]);
    if (key !== Rm.key) {
      Rm.key = key;
      if (d.kind === "hall") paintHall(Rm, d);
      else paintScene(Rm, d);
      release(Rm);
    }
    syncActors(Rm, d.mons || []);
  }

  /* ================= 길드 홀 =================
     길드는 방처럼 꾸미지 않는다 — 모두가 모이는 곳이라 따로 그린다. 돌벽, 길드 색 깃발,
     횃불, 길드 이름 간판, 가운데 분수. 길드원마다 대표 포켓몬 한 마리가 이름표를 달고 모인다.
     길드 색은 길드 코드로 정한다(같은 길드면 누구 화면에서나 같은 색). */

  const GUILD_COLORS = [
    ["#c62828", "#ef9a9a", "#8e1b1b"], ["#1565c0", "#90caf9", "#0d3f7d"], ["#2e7d32", "#a5d6a7", "#1b4d1f"],
    ["#6a1b9a", "#ce93d8", "#45106a"], ["#ef6c00", "#ffcc80", "#a84b00"], ["#00838f", "#80deea", "#005058"],
  ];
  function guildColor(code) {
    let h = 0;
    for (const c of String(code || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return GUILD_COLORS[h % GUILD_COLORS.length];
  }

  function hallWall(g) {
    R(g, 0, 0, AW, FLOOR, "#8f877c");
    const r = seeded(31);
    for (let y = 8, row = 0; y < FLOOR - 6; y += 10, row++) {
      for (let x = (row % 2) * -10; x < AW; x += 20) {
        const shade = r();
        R(g, x, y, 20, 10, "#6f675d"); // 줄눈
        R(g, x + 1, y + 1, 18, 8, shade < 0.33 ? "#9a9186" : shade < 0.66 ? "#a39a8e" : "#928a7f");
        R(g, x + 1, y + 1, 18, 1, "#b2a99c");
      }
    }
    // 천장 들보
    R(g, 0, 0, AW, 8, "#5d4037"); R(g, 0, 7, AW, 1, "#3e2723");
    for (let x = 10; x < AW; x += 50) { R(g, x, 0, 6, 10, "#4e342e"); R(g, x, 9, 6, 1, "#3e2723"); }
  }

  function hallFloor(g) {
    R(g, 0, FLOOR, AW, AH - FLOOR, "#7e776d");
    const r = seeded(17);
    for (let y = FLOOR + 3, row = 0; y < AH; y += 8, row++) {
      for (let x = (row % 2) * 7; x < AW; x += 14) {
        const c = r() < 0.5 ? "#8c8579" : "#857e72";
        oval(g, x + 6, y + 2, 6, 3, "#6b655c");
        oval(g, x + 6, y + 2, 5, 2, c);
        R(g, x + 3, y, 3, 1, "#9c958a");
      }
    }
  }

  /**
   * 길드 마크(9×9) — 깃발의 흰 방패 위에 길드 색으로 찍는다. 길드장이 고른다(hall.json marks).
   * 처음엔 별 하나뿐이라 길드마다 깃발이 색만 달랐다.
   */
  const MARKS = {
    star: ["....#....", "....#....", "...###...", "#########", ".#######.", "..#####..", "..##.##..", ".##...##.", ".#.....#."],
    ball: ["..#####..", ".#.....#.", "#.......#", "#...#...#", "####.####", "#...#...#", "#.......#", ".#.....#.", "..#####.."],
    flame: ["....#....", "...##....", "...###...", "..####.#.", "..######.", ".###.###.", ".##...##.", ".##...##.", "..#####.."],
    drop: ["....#....", "....#....", "...###...", "..#####..", ".#######.", ".####.##.", ".###.###.", "..#####..", "...###..."],
    leaf: [".......##", ".....####", "...######", "..######.", ".###.##..", ".##.##...", ".#.##....", ".##......", "#........"],
    bolt: ["....####.", "...####..", "..####...", ".#######.", "...####..", "..####...", ".####....", ".##......", ".#......."],
    crown: ["#...#...#", "##.###.##", "#########", "#########", "#.#.#.#.#", "#########", ".........", "#########", "#########"],
    moon: ["..#####..", ".###.....", "###......", "###......", "###......", "###......", "###......", ".###.....", "..#####.."],
    sword: ["........#", ".......##", "......##.", ".....##..", "#...##...", ".#.##....", "..##.....", ".#.##....", "#...#...."],
    wing: ["#........", "##.......", "###......", "####.....", "#.###....", "##.###...", ".##.###..", "..##.###.", "....#####"],
    paw: ["..##.##..", "..##.##..", "#.......#", "##.....##", "...###...", "..#####..", ".#######.", ".#######.", "..##.##.."],
    heart: [".##...##.", "####.####", "#########", "#########", ".#######.", "..#####..", "...###...", "....#....", "........."],
  };
  function drawMark(g, x0, y0, id, c) {
    (MARKS[id] || MARKS.star).forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === "#") R(g, x0 + i, y0 + j, 1, 1, c); });
  }
  /** 방패 하나(14×16)에 마크 — 깃발과 길드 화면의 마크 고르기 단추가 같이 쓴다 */
  function shield(g, x, y, id, c) {
    for (let i = 0; i < 16; i++) { const w = i < 10 ? 14 : 14 - (i - 9) * 2; R(g, x + 7 - (w >> 1), y + i, w, 1, i === 0 ? "#fff" : "#f5f5f5"); }
    drawMark(g, x + 3, y + 2, id, c);
  }

  // 홀 바닥에 늘 있는 것 — 자리 · 크기. 그림은 HALL_SVG
  const HALL = {
    fountain: { x: 126, y: 120, w: 68, h: 48 },
    treeL: { x: 6, y: 138, w: 26, h: 54 },
    treeR: { x: 288, y: 138, w: 26, h: 54 },
  };

  /* ---- 홀 꾸미기 (hall.json — 길드원이 모금으로 산다) ---- */

  // 모금으로 사는 홀 꾸미기 중 바닥에 서는 것 — 크기만. 그림은 HALL_SVG, 벽 쪽 장식은 hallDecorSvg
  const MASCOT = { w: 40, h: 70 }; // 마스코트 석상 — 지난주 1위의 대표 포켓몬을 돌로(방의 전설 석상과 같은 stoneOf)
  const SHELF = { w: 30, h: 50 }; // 길드 서재 — 오른쪽 벽 앞 책장, 맨 위에 지구본
  const PIANO = { w: 52, h: 38 }; // 그랜드 피아노 — 왼쪽 바닥
  const SOFA = { w: 38, h: 26 }; // 라운지 소파 — 오른쪽 바닥, 길드 색 천

  /* ================= 길드 홀 SVG =================
     벽 쪽 장식(깃발 · 간판 · 게시판/전광판 · 횃불 · 샹들리에 · 등불 줄 · 벽 수족관 · 트로피 진열장)과 융단은
     홀 전체(320 × 200) 한 장의 SVG(hallDecorSvg) — 좌표가 캔버스 그대로다. 바닥에 서는 것(분수 · 화분 나무 ·
     화단 · 서재 · 피아노 · 소파 · 마스코트)은 하나씩 따로(HALL_SVG) — 포켓몬과 앞뒤를 가려야 해서.
     배경(성 · 벚꽃 · 서울대 · 신전의 벽 · 바닥)은 도트 그대로, 그 위에 roomLightSvg 조명 */
  function hallDecorSvg(o) {
    const { col, mark, has, night, board, goal, outdoor } = o;
    const [c, hi, dk] = col;
    const p = "hd" + ++wallUid;
    const out = [];
    /*
     * 🌸 바깥 배경(벚꽃 · 서울대)은 벽 · 천장이 없어 깃발 · 간판 · 등불 · 샹들리에가 하늘에 떠 있었다.
     * 양 끝 기둥에 지붕 얹은 들보를 건너질러 거기에 매달고, 횃불 · 게시판 · 수족관은 땅에 박은 다리로 세운다
     */
    if (outdoor) {
      const G = FLOOR + 3, post = (x) => `<ellipse cx="${x + 3}" cy="${G + 1}" rx="6" ry="1.5" fill="#000" opacity=".22"/><rect x="${x}" y="8" width="6" height="${G - 8}" fill="url(#${p}pw)" stroke="#3e2410" stroke-width=".5"/><rect x="${x - 1}" y="${G - 4}" width="8" height="4" rx=".6" fill="#4e3018"/>`;
      const leg = (x, y0) => `<ellipse cx="${x + 1.2}" cy="${G + .6}" rx="3" ry="1" fill="#000" opacity=".2"/><rect x="${x}" y="${y0}" width="2.4" height="${G - y0}" fill="url(#${p}pw)" stroke="#3e2410" stroke-width=".3"/>`;
      out.push(post(1), post(AW - 7));
      out.push(`<rect x="0" y="7" width="${AW}" height="5.4" fill="url(#${p}wd)" stroke="#3e2410" stroke-width=".5"/>
        <rect x="0" y="7.4" width="${AW}" height=".8" fill="#c99566" opacity=".7"/>
        <path d="M-4 7.4 L4 1 H${AW - 4} L${AW + 4} 7.4 Z" fill="url(#${p}rf)" stroke="#3e2410" stroke-width=".5"/>
        ${Array.from({ length: 54 }, (_, i) => `<path d="M${2 + i * 6} 1.6 V7" stroke="#3e2410" stroke-opacity=".35" stroke-width=".4"/>`).join("")}
        ${[[7, 1], [AW - 7, -1]].map(([x, s]) => `<path d="M${x} 12.4 L${x + s * 8} 12.4 L${x} 20 Z" fill="url(#${p}wd)" stroke="#3e2410" stroke-width=".4"/>`).join("")}`);
      for (const x of [84, 232]) out.push(leg(x + 1.3, 55)); // 횃불 기둥
      if (board) out.push(leg(235.6, 100), leg(252.6, 100)); else out.push(leg(229, 93), leg(261, 93)); // 게시판 · 전광판 다리
      if (has("aquarium")) out.push(leg(140, 94), leg(179.6, 94)); // 수족관 받침대 다리
    }
    const mk = (x0, y0) => (MARKS[mark] || MARKS.star).map((row, j) => [...row].map((ch, i) => (ch === "#" ? `<rect x="${x0 + i}" y="${y0 + j}" width="1.02" height="1.02"/>` : "")).join("")).join("");
    // 융단 — 입구에서 분수까지(바닥). 금테면 굵은 금실 · 마름모
    const gold = has("goldCarpet");
    out.push(`<path d="M136 ${FLOOR} H184 L222 ${AH} H98 Z" fill="url(#${p}cp)"/>`);
    for (let y = FLOOR + 6; y < AH; y += 6) { const w = 24 + (y - FLOOR) * 0.5; out.push(`<path d="M${160 - w} ${y} H${160 + w}" stroke="${dk}" stroke-opacity=".55" stroke-width=".6"/>`); }
    const bw = gold ? 3.2 : 1.8;
    out.push(`<path d="M136 ${FLOOR} L98 ${AH} M184 ${FLOOR} L222 ${AH}" stroke="#c9a227" stroke-width="${bw}"/>`);
    if (gold) {
      out.push(`<path d="M137.6 ${FLOOR} L99.6 ${AH} M182.4 ${FLOOR} L220.4 ${AH}" stroke="#ffe28a" stroke-width=".7"/>`);
      for (let y = FLOOR + 10; y < AH; y += 14) { const w = 24 + (y - FLOOR) * 0.5 - 9; out.push(`<path d="M${160 - w} ${y - 2} l2 2 l-2 2 l-2 -2 Z M${160 + w} ${y - 2} l2 2 l-2 2 l-2 -2 Z" fill="#ffe28a"/>`); }
    }
    out.push(`<path d="M136 ${FLOOR} H184 L186 ${FLOOR + 4} H134 Z" fill="#000" opacity=".18"/>`);
    // 깃발 — 금봉 · 길드 색 천 · 흰 방패에 마크 · 아래 술
    const banner = (x) => out.push(`<g>
      <path d="M${x} 15 H${x + 26} V62 L${x + 13} 72 L${x} 62 Z" fill="url(#${p}bn)" stroke="${dk}" stroke-width=".6" stroke-linejoin="round"/>
      <path d="M${x + 2} 16 V61 L${x + 13} 69.6 L${x + 24} 61 V16" fill="none" stroke="#e8c45a" stroke-width=".6"/>
      ${[7, 13, 19].map((dx) => `<path d="M${x + dx} 16 V${62 + (dx === 13 ? 8 : 4)}" stroke="#000" stroke-opacity=".12" stroke-width="1"/>`).join("")}
      <path d="M${x + 6} 26 H${x + 20} V36 Q${x + 20} 41 ${x + 13} 43 Q${x + 6} 41 ${x + 6} 36 Z" fill="url(#${p}sh)" stroke="#c9a227" stroke-width=".6"/>
      <g fill="${c}" shape-rendering="crispEdges">${mk(x + 8.5, 28)}</g>
      <path d="M${x + 13} 72 V75" stroke="#c9a227" stroke-width=".7"/><path d="M${x + 11.6} 75 H${x + 14.4} L${x + 13.6} 79 H${x + 12.4} Z" fill="#ffd54f" stroke="#a87400" stroke-width=".3"/>
      <rect x="${x - 3}" y="12" width="32" height="3" rx="1.5" fill="url(#${p}gd)" stroke="#8a6a12" stroke-width=".35"/>
      <circle cx="${x - 3.6}" cy="13.5" r="1.8" fill="#ffd54f" stroke="#8a6a12" stroke-width=".35"/><circle cx="${x + 29.6}" cy="13.5" r="1.8" fill="#ffd54f" stroke="#8a6a12" stroke-width=".35"/></g>`);
    banner(30); banner(264);
    if (has("banners")) { banner(3); banner(291); }
    // 간판 — 쇠사슬에 매단 나무판, 위아래 금띠. 길드 이름은 글자로(160, 30)
    out.push(`<path d="M111 8 V17 M209 8 V17" stroke="#6d6d6d" stroke-width="1.2" stroke-dasharray="1.4 .7"/>
      <rect x="108" y="16" width="104" height="28" rx="2" fill="url(#${p}wd)" stroke="#3e2410" stroke-width=".7"/>
      <rect x="111" y="19.4" width="98" height="21.2" rx="1" fill="#6a4122" stroke="#4e3018" stroke-width=".4"/>
      <path d="M113 24 Q140 22.6 170 24.4 T207 23.6 M113 35 Q150 36.4 180 34.8 T207 35.6" fill="none" stroke="#7d4f2b" stroke-width=".6"/>
      <rect x="108" y="16" width="104" height="2" fill="url(#${p}gd)"/><rect x="108" y="42" width="104" height="2" fill="url(#${p}gd)"/>
      ${[[110, 18], [210, 18], [110, 42], [210, 42]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".9" fill="#ffe28a" stroke="#8a6a12" stroke-width=".3"/>`).join("")}`);
    // 게시판 · 전광판
    if (board) {
      const pct = goal ? Math.min(1, goal.total / goal.tiers[2]) : 0, ticks = goal ? goal.tiers.slice(0, 2).map((t) => t / goal.tiers[2]) : [];
      out.push(`<rect x="235.4" y="95" width="3.2" height="7" fill="#455a64"/><rect x="252.4" y="95" width="3.2" height="7" fill="#455a64"/>
        <rect x="224" y="60" width="44" height="36" rx="2" fill="url(#${p}bb)" stroke="#0d1317" stroke-width=".6"/>
        <rect x="227" y="63" width="38" height="30" rx="1" fill="#0b1a3a"/>
        ${Array.from({ length: 10 }, (_, i) => `<rect x="227" y="${63 + i * 3}" width="38" height=".4" fill="#fff" opacity=".04"/>`).join("")}
        <rect x="230" y="82" width="32" height="5" rx="1.2" fill="#1e2a44"/>
        <rect x="230" y="82" width="${(32 * pct).toFixed(2)}" height="5" rx="1.2" fill="url(#${p}pg)"/>
        ${ticks.map((t) => `<rect x="${(230 + 32 * t - .3).toFixed(2)}" y="80.6" width=".6" height="7.8" fill="#fff" opacity=".7"/>`).join("")}
        <path d="M227 63 L240 63 L229 93 H227 Z" fill="#fff" opacity=".05"/>`);
    } else {
      const notes = [[230, 66, "#fff9c4", -4], [245, 64, "#ffffff", 3], [233, 79, "#e1f5fe", 2], [251, 77, "#fce4ec", -3]];
      out.push(`<rect x="226" y="62" width="40" height="32" rx="1.2" fill="url(#${p}wd)" stroke="#4e3018" stroke-width=".6"/>
        <rect x="228.4" y="64.4" width="35.2" height="27.2" fill="#c8a46e"/>
        ${Array.from({ length: 24 }, (_, i) => `<circle cx="${229.5 + ((i * 7.3) % 33)}" cy="${65.5 + ((i * 4.1) % 25)}" r=".35" fill="#a8834f"/>`).join("")}
        ${notes.map(([x, y, n, r]) => `<g transform="rotate(${r} ${x + 6} ${y + 5.5})"><rect x="${x + .5}" y="${y + .6}" width="12" height="11" fill="#000" opacity=".15"/><rect x="${x}" y="${y}" width="12" height="11" fill="${n}"/><rect x="${x + 2}" y="${y + 3}" width="8" height=".7" fill="#9e9e9e"/><rect x="${x + 2}" y="${y + 5.4}" width="6" height=".7" fill="#bdbdbd"/><rect x="${x + 2}" y="${y + 7.8}" width="7" height=".7" fill="#bdbdbd"/><circle cx="${x + 6}" cy="${y + .4}" r="1.1" fill="#e53935"/><circle cx="${x + 5.7}" cy="${y + .1}" r=".4" fill="#ff8a80"/></g>`).join("")}`);
    }
    // 횃불 — 쇠 받침 · 나무 손잡이 · 일렁이는 불 · 둘레 빛(밤에 더 밝다)
    for (const x of [84, 232]) out.push(`<g opacity="${night ? 1 : .55}"><circle class="cf-glow" cx="${x + 2.5}" cy="40" r="26" fill="url(#${p}tg)"/></g>
      <path d="M${x - 2} 44 H${x + 7} L${x + 5.6} 46 H${x - .6} Z" fill="#3e2723"/><path d="M${x} 46 H${x + 5} L${x + 4} 56 H${x + 1} Z" fill="url(#${p}wd)" stroke="#3e2723" stroke-width=".4"/><rect x="${x - 1}" y="54" width="7" height="2" rx=".6" fill="#3e2723"/>
      <path class="cf-fire" d="M${x + 2.5} 32 C${x + 6} 36 ${x + 6.6} 40 ${x + 5.2} 43 C${x + 4} 45 ${x + 1} 45 ${x - .2} 43 C${x - 1.4} 40 ${x} 38 ${x + 1.2} 37 C${x + 1.4} 39 ${x + 2.4} 39.4 ${x + 2.6} 38 C${x + 3} 36 ${x + 2.2} 34 ${x + 2.5} 32 Z" fill="url(#${p}fl)"/>
      <ellipse class="cf-fire b" cx="${x + 2.5}" cy="41.6" rx="1.4" ry="2.2" fill="#fff3c4"/>`);
    // 등불 줄
    if (has("lanterns")) for (const [x0, x1] of [[58, 87], [233, 262]]) {
      out.push(`<path d="M${x0} 12 Q${(x0 + x1) / 2} 24 ${x1} 12" fill="none" stroke="#3e2723" stroke-width=".6"/>`);
      for (let i = 0; i < 4; i++) {
        const x = x0 + 4 + ((x1 - x0 - 8) * i) / 3, t = (x - x0) / (x1 - x0), y = 12 + 12 * t * (1 - t) * 2 * 0.5 * 2 + 1;
        const lc = i % 2 ? ["#ffb06a", "#ff8a3d", "#c45a12"] : ["#ff8a7e", "#e53935", "#9a1b1b"];
        out.push(`${night ? `<circle cx="${x}" cy="${y + 6}" r="9" fill="url(#${p}lg)"/>` : ""}<g class="cf-swing" style="animation-delay:${(-i * .7).toFixed(1)}s">
          <path d="M${x} ${y} V${y + 2}" stroke="#3e2723" stroke-width=".4"/>
          <rect x="${x - 2.2}" y="${y + 1.6}" width="4.4" height="1.1" rx=".3" fill="#c9a227"/>
          <ellipse cx="${x}" cy="${y + 6.4}" rx="3.2" ry="4" fill="${lc[1]}" stroke="${lc[2]}" stroke-width=".35"/>
          <path d="M${x - 1.6} ${y + 2.8} Q${x - 2.6} ${y + 6.4} ${x - 1.6} ${y + 10} M${x + 1.6} ${y + 2.8} Q${x + 2.6} ${y + 6.4} ${x + 1.6} ${y + 10}" fill="none" stroke="${lc[2]}" stroke-opacity=".5" stroke-width=".35"/>
          <ellipse cx="${x - 1}" cy="${y + 5.4}" rx=".9" ry="2" fill="${lc[0]}" opacity=".8"/>
          <rect x="${x - 2.2}" y="${y + 10}" width="4.4" height="1.1" rx=".3" fill="#c9a227"/>
          <path d="M${x} ${y + 11} V${y + 13.6}" stroke="#ffd54f" stroke-width=".7"/></g>`);
      }
    }
    // 샹들리에
    if (has("chandelier")) for (const x of [98, 222]) out.push(`${night ? `<circle class="cf-glow" cx="${x}" cy="17" r="24" fill="url(#${p}cg)"/>` : ""}
      <path d="M${x} 0 V10" stroke="#c9a227" stroke-width=".7"/>
      <path d="M${x - 8} 15 Q${x} 19.6 ${x + 8} 15 M${x - 3} 15 Q${x} 17 ${x + 3} 15" fill="none" stroke="#c9a227" stroke-width=".8"/>
      <ellipse cx="${x}" cy="15.6" rx="9" ry="2.6" fill="url(#${p}gd)" stroke="#8a6a12" stroke-width=".4"/>
      ${[-8, -3, 3, 8].map((dx) => `<rect x="${x + dx - .6}" y="10" width="1.2" height="5.2" rx=".3" fill="#fff8e1"/><path class="cf-fire" d="M${x + dx} 7 C${x + dx + 1.2} 8.4 ${x + dx + .9} 10 ${x + dx} 10 C${x + dx - .9} 10 ${x + dx - 1.2} 8.4 ${x + dx} 7 Z" fill="#ffb74d"/><circle cx="${x + dx}" cy="9.2" r=".45" fill="#fff3c4"/>`).join("")}
      ${[-6, -2, 2, 6].map((dx) => `<path d="M${x + dx} 18 V20.6" stroke="#c9a227" stroke-width=".3"/><path d="M${x + dx} 20.4 l.9 1.4 l-.9 1.6 l-.9 -1.6 Z" fill="#d6f2ff" stroke="#90caf9" stroke-width=".2"/>`).join("")}
      <path d="M${x} 18 V23" stroke="#c9a227" stroke-width=".4"/><path d="M${x} 23 l1.4 2 l-1.4 2.4 l-1.4 -2.4 Z" fill="#e3f6ff" stroke="#90caf9" stroke-width=".25"/>`);
    // 벽 수족관
    if (has("aquarium")) {
      const x = 138, y = 58;
      out.push(`<rect x="${x - 2}" y="${y + 34}" width="48" height="3" rx=".6" fill="url(#${p}wd)" stroke="#3e2723" stroke-width=".35"/>
        <rect x="${x}" y="${y}" width="44" height="34" rx="1.2" fill="url(#${p}aq)" stroke="#263238" stroke-width=".7"/>
        <path d="M${x + 1.4} ${y + 27} Q${x + 12} ${y + 25.6} ${x + 22} ${y + 27.2} T${x + 42.6} ${y + 26.6} V${y + 32.6} H${x + 1.4} Z" fill="#e8d39a"/>
        ${[[5, 14, 1], [9, 9, -1], [36, 12, 1], [39, 7, -1]].map(([dx, h, s]) => `<path d="M${x + dx} ${y + 27.4} C${x + dx + s * 1.8} ${y + 27 - h / 3} ${x + dx - s * 1.8} ${y + 27 - h * 2 / 3} ${x + dx + s * .6} ${y + 27 - h}" fill="none" stroke="#43a047" stroke-width="1.1" stroke-linecap="round"/>`).join("")}
        ${[[14, 11, "#ff8a3d", 1, 0], [26, 17, "#ffd54f", -1, -1.4], [18, 22, "#ef5350", 1, -2.6], [31, 9, "#b388ff", -1, -.8]].map(([fx, fy, fc, d, dl]) => `<g class="cf-swim${d < 0 ? " r" : ""}" style="animation-delay:${dl}s"><path d="M${x + fx} ${y + fy + 1.5} C${x + fx + 1.6 * d} ${y + fy - .4} ${x + fx + 4 * d} ${y + fy - .4} ${x + fx + 5.4 * d} ${y + fy + 1.5} C${x + fx + 4 * d} ${y + fy + 3.4} ${x + fx + 1.6 * d} ${y + fy + 3.4} ${x + fx} ${y + fy + 1.5} Z M${x + fx + .4 * d} ${y + fy + 1.5} L${x + fx - 2 * d} ${y + fy} V${y + fy + 3} Z" fill="${fc}"/><circle cx="${x + fx + 4 * d}" cy="${y + fy + 1.1}" r=".45" fill="#1a1a1a"/></g>`).join("")}
        ${[[12, 7], [13, 4.6], [29, 13], [30, 10]].map(([bx, by]) => `<circle cx="${x + bx}" cy="${y + by}" r=".55" fill="none" stroke="#e3f6ff" stroke-width=".3"/>`).join("")}
        <rect x="${x + 1}" y="${y + 1}" width="42" height="2.6" fill="#b6ecff" opacity=".7"/>
        <path d="M${x + 4} ${y + 33} L${x + 14} ${y + 1} H${x + 18} L${x + 8} ${y + 33} Z" fill="#fff" opacity=".12"/>`);
    }
    // 우승 트로피 진열장 — 목표 🥇를 이룬 주만큼(6개까지)
    if (has("trophies")) {
      const x = 36, y = 78, n = Math.min(6, o.golds || 0);
      out.push(`<rect x="${x}" y="${y}" width="42" height="46" rx="1.2" fill="url(#${p}wd)" stroke="#3e2723" stroke-width=".6"/>
        <rect x="${x + 3}" y="${y + 3}" width="36" height="38" fill="#2a1a16"/><rect x="${x + 3}" y="${y + 21}" width="36" height="2" fill="#8d6e63"/><rect x="${x + 3}" y="${y + 39}" width="36" height="2" fill="#8d6e63"/>
        ${Array.from({ length: n }, (_, i) => { const tx = x + 9.5 + (i % 3) * 11.5, ty = y + 5 + Math.floor(i / 3) * 18; return `<path d="M${tx - 3.4} ${ty} H${tx + 3.4} C${tx + 3.4} ${ty + 4.4} ${tx + 1.6} ${ty + 6.4} ${tx} ${ty + 6.6} C${tx - 1.6} ${ty + 6.4} ${tx - 3.4} ${ty + 4.4} ${tx - 3.4} ${ty} Z" fill="url(#${p}tc)" stroke="#8a5a00" stroke-width=".3"/><path d="M${tx - 3.2} ${ty + 1} C${tx - 5.4} ${ty + 1} ${tx - 5.2} ${ty + 4} ${tx - 2.2} ${ty + 4.4} M${tx + 3.2} ${ty + 1} C${tx + 5.4} ${ty + 1} ${tx + 5.2} ${ty + 4} ${tx + 2.2} ${ty + 4.4}" fill="none" stroke="#c49000" stroke-width=".7"/><rect x="${tx - .7}" y="${ty + 6.4}" width="1.4" height="3.6" fill="#c49000"/><rect x="${tx - 3}" y="${ty + 10}" width="6" height="2.8" rx=".4" fill="#5d4037"/><rect x="${tx - 1.8}" y="${ty + 10.8}" width="3.6" height=".9" fill="#ffd54f"/>`; }).join("")}
        <rect x="${x + 3}" y="${y + 3}" width="36" height="38" fill="#bfe8f7" opacity=".14"/>
        <path d="M${x + 6} ${y + 5} L${x + 12} ${y + 5} L${x + 6} ${y + 24} Z M${x + 6} ${y + 26} L${x + 9} ${y + 26} L${x + 6} ${y + 36} Z" fill="#fff" opacity=".22"/>`);
    }
    return `<div class="rm-wl rm-anim" style="left:0; top:0; width:100%; height:100%;"><svg viewBox="0 0 ${AW} ${AH}" aria-hidden="true"><defs>
      <linearGradient id="${p}cp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${dk}"/><stop offset=".35" stop-color="${c}"/><stop offset="1" stop-color="${c}"/></linearGradient>
      <linearGradient id="${p}bn" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${dk}"/><stop offset=".3" stop-color="${hi}" stop-opacity=".9"/><stop offset=".55" stop-color="${c}"/><stop offset="1" stop-color="${dk}"/></linearGradient>
      <linearGradient id="${p}sh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dcdcdc"/></linearGradient>
      ${GOLD(p + "gd", 'x1="0" y1="0" x2="0" y2="1"')}${GOLD(p + "tc", 'x1="0" y1="0" x2="1" y2="0"')}
      ${WOOD(p + "wd", "#a8743f", "#7a4e2a", "#4e3018")}
      <linearGradient id="${p}bb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#455a64"/><stop offset="1" stop-color="#1c262b"/></linearGradient>
      <linearGradient id="${p}pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8ffd9"/><stop offset="1" stop-color="#22b46c"/></linearGradient>
      <linearGradient id="${p}aq" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9bdcff"/><stop offset=".3" stop-color="#4fa3d9"/><stop offset="1" stop-color="#1e5f94"/></linearGradient>
      <linearGradient id="${p}fl" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff6f00"/><stop offset=".6" stop-color="#ffa726"/><stop offset="1" stop-color="#ffe082"/></linearGradient>
      <radialGradient id="${p}tg"><stop offset="0" stop-color="#ffaa3c" stop-opacity=".4"/><stop offset="1" stop-color="#ffaa3c" stop-opacity="0"/></radialGradient>
      <radialGradient id="${p}cg"><stop offset="0" stop-color="#ffdc8c" stop-opacity=".35"/><stop offset="1" stop-color="#ffdc8c" stop-opacity="0"/></radialGradient>
      <radialGradient id="${p}lg"><stop offset="0" stop-color="#ff7850" stop-opacity=".35"/><stop offset="1" stop-color="#ff7850" stop-opacity="0"/></radialGradient>
      <linearGradient id="${p}pw" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5e3a1d"/><stop offset=".4" stop-color="#8a5a32"/><stop offset="1" stop-color="#4e3018"/></linearGradient>
      <linearGradient id="${p}rf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8d4a2a"/><stop offset="1" stop-color="#5d2e18"/></linearGradient>
    </defs>${out.join("")}</svg></div>`;
  }

  /** 홀 바닥에 서는 것 — 크기는 예전 캔버스 그대로(분수 68 × 48, 나무 26 × 54, 화단 58 × 20, 서재 30 × 50, 피아노 52 × 38, 소파 38 × 26, 마스코트 40 × 70) */
  const HALL_SVG = {
    fountain: (p, gold) => {
      const rim = gold ? ["#fff3b0", "#e0b84a", "#a07a1e"] : ["#c9c1b5", "#a39a8e", "#6f675d"];
      return `<defs>
        <linearGradient id="${p}r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${rim[0]}"/><stop offset=".5" stop-color="${rim[1]}"/><stop offset="1" stop-color="${rim[2]}"/></linearGradient>
        <linearGradient id="${p}c" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${rim[2]}"/><stop offset=".3" stop-color="${rim[0]}"/><stop offset=".7" stop-color="${rim[1]}"/><stop offset="1" stop-color="${rim[2]}"/></linearGradient>
        <radialGradient id="${p}w" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#9bdcff"/><stop offset="1" stop-color="#3b8fc4"/></radialGradient>
        <clipPath id="${p}k"><ellipse cx="34" cy="34" rx="27" ry="6"/></clipPath></defs>
        <ellipse cx="34" cy="39" rx="33" ry="8.6" fill="#000" opacity=".22"/>
        <ellipse cx="34" cy="35.6" rx="32" ry="9" fill="url(#${p}r)" stroke="${rim[2]}" stroke-width=".5"/>
        <ellipse cx="34" cy="34.4" rx="29.4" ry="7.2" fill="${rim[2]}"/>
        <ellipse cx="34" cy="34" rx="27" ry="6" fill="url(#${p}w)"/>
        <g clip-path="url(#${p}k)">${[[22, 34], [46, 35], [34, 36]].map(([x, y], i) => `<ellipse class="cf-ripple" style="animation-delay:${-i * 1.1}s" cx="${x}" cy="${y}" rx="5" ry="1.4" fill="none" stroke="#e3f6ff" stroke-width=".45"/>`).join("")}</g>
        <rect x="30" y="14" width="8" height="20" fill="url(#${p}c)" stroke="${rim[2]}" stroke-width=".4"/>
        <ellipse cx="34" cy="14.4" rx="12" ry="3.2" fill="url(#${p}r)" stroke="${rim[2]}" stroke-width=".4"/>
        <ellipse cx="34" cy="13.6" rx="10" ry="2" fill="#6ec3f4"/>
        ${[[-1, 1], [1, 1]].map(([s]) => `<path class="cf-flow" d="M${34 + s * 10} 14.4 C${34 + s * 14} 16 ${34 + s * 14.6} ${gold ? 24 : 26} ${34 + s * 13.6} 32" fill="none" stroke="#bfeaff" stroke-width=".9" stroke-dasharray="2 1.2" stroke-linecap="round"/>`).join("")}
        ${gold ? [-1, 1].map((s) => `<path class="cf-flow" d="M${34 + s * 4} 2 C${34 + s * 10} 4 ${34 + s * 18} 16 ${34 + s * 20} 31" fill="none" stroke="#e3f6ff" stroke-width=".6" stroke-dasharray="1.6 1.4"/>`).join("") : ""}
        <path class="cf-flow" d="M34 ${gold ? 0 : 3} V13" stroke="#e3f6ff" stroke-width="1.4" stroke-dasharray="2 1" stroke-linecap="round"/>
        <ellipse cx="34" cy="${gold ? 0.6 : 3.4}" rx="2.2" ry="1" fill="#fff" opacity=".8"/>
        <ellipse cx="22" cy="32" rx="6" ry="1.2" fill="#fff" opacity=".35"/>`;
    },
    tree: (p) => `<defs>${WOOD(p + "p", "#c08955", "#8d5a34", "#4e3018")}
      <radialGradient id="${p}l" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#6cc070"/><stop offset=".6" stop-color="#3f8a4a"/><stop offset="1" stop-color="#1f5a2a"/></radialGradient></defs>
      <ellipse cx="13" cy="53.4" rx="10" ry="1" fill="#000" opacity=".25"/>
      <path d="M12 41 C11.6 34 12.6 30 12.4 25 H14 C13.8 30 14.6 34 14.2 41 Z" fill="#5d4037"/>
      <circle cx="13" cy="16" r="12" fill="url(#${p}l)" stroke="#1f5a2a" stroke-width=".5"/>
      ${[[8, 11, 3.6], [16, 9, 3], [18, 18, 3.4], [7, 20, 3], [12.6, 15, 3.2]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#5aa864" opacity=".55"/>`).join("")}
      <ellipse cx="9" cy="9" rx="3" ry="2" fill="#a5d6a7" opacity=".6"/>
      <path d="M5.4 40 H20.6 L19.4 53.4 H6.6 Z" fill="url(#${p}p)" stroke="#3e2410" stroke-width=".5"/>
      <rect x="4.4" y="39" width="17.2" height="2.6" rx=".6" fill="#a8743f" stroke="#3e2410" stroke-width=".4"/><ellipse cx="13" cy="39.4" rx="7.4" ry=".8" fill="#3e2723"/>`,
    bed: (p, seed) => {
      const r = seeded(seed), cols = ["#ff6b8a", "#ffd54f", "#b388ff", "#ffffff", "#ff8a65"];
      const flowers = Array.from({ length: 13 }, () => { const fx = 4 + r() * 50, fy = 2 + r() * 6, c = cols[Math.floor(r() * 5)]; return `<path d="M${fx.toFixed(1)} ${(fy + 2).toFixed(1)} V${(fy + 7.4).toFixed(1)}" stroke="#3f8a4a" stroke-width=".7"/><ellipse cx="${(fx + 1.2).toFixed(1)}" cy="${(fy + 4.6).toFixed(1)}" rx="1.2" ry=".55" fill="#5aa864"/>${[0, 72, 144, 216, 288].map((a) => `<circle cx="${(fx + Math.cos((a * Math.PI) / 180) * 1.1).toFixed(2)}" cy="${(fy + 1 + Math.sin((a * Math.PI) / 180) * 1.1).toFixed(2)}" r=".85" fill="${c}"/>`).join("")}<circle cx="${fx.toFixed(1)}" cy="${(fy + 1).toFixed(1)}" r=".6" fill="#ffe082"/>`; }).join("");
      return `<defs>${WOOD(p + "w", "#a1887f", "#6d4c41", "#3e2723")}</defs>
        <ellipse cx="29" cy="19.6" rx="28" ry="1" fill="#000" opacity=".22"/>
        <rect x=".3" y="4" width="57.4" height="15.6" rx="1" fill="url(#${p}w)" stroke="#3e2723" stroke-width=".5"/>
        <rect x="2" y="5.6" width="54" height="4" rx=".6" fill="#4e342e"/>
        <path d="M2 13 H56" stroke="#3e2723" stroke-opacity=".5" stroke-width=".4"/>${flowers}`;
    },
    shelf: (p) => {
      const r = seeded(44), cols = ["#c62828", "#1565c0", "#2e7d32", "#f9a825", "#6a1b9a", "#ef6c00", "#00838f"];
      let books = "";
      for (const sy of [14, 26, 38]) {
        books += `<rect x="2" y="${sy + 10}" width="26" height="2" fill="#8d6e63"/>`;
        for (let bx = 3; bx < 27;) {
          const bw = 2 + Math.floor(r() * 2), bh = 6 + Math.floor(r() * 4);
          if (bx + bw > 27) break;
          const c = cols[Math.floor(r() * cols.length)];
          books += `<rect x="${bx}" y="${sy + 10 - bh}" width="${bw - .15}" height="${bh}" rx=".3" fill="${c}" stroke="#000" stroke-opacity=".3" stroke-width=".25"/><rect x="${bx}" y="${sy + 11.2 - bh}" width="${bw - .15}" height=".6" fill="#ffd54f" opacity=".8"/><rect x="${bx}" y="${sy + 10 - bh}" width=".5" height="${bh}" fill="#fff" opacity=".3"/>`;
          bx += bw + (r() < 0.2 ? 1 : 0);
        }
      }
      return `<defs>${WOOD(p + "w", "#8d6e63", "#5d4037", "#2a1a16")}
        <radialGradient id="${p}g" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#90caf9"/><stop offset=".6" stop-color="#1e88e5"/><stop offset="1" stop-color="#0d47a1"/></radialGradient></defs>
        <ellipse cx="15" cy="49.6" rx="14" ry=".8" fill="#000" opacity=".25"/>
        <rect x=".3" y="10" width="29.4" height="40" rx="1" fill="url(#${p}w)" stroke="#1e120e" stroke-width=".5"/>
        <rect x="2" y="12" width="26" height="36" fill="#2e1d18"/>${books}
        <path d="M9 10 V1 Q9 0 10 0" fill="none" stroke="#c9a227" stroke-width=".7"/><rect x="12" y="9.4" width="6" height="1" rx=".3" fill="#c9a227"/>
        <circle cx="15" cy="5" r="4.6" fill="url(#${p}g)" stroke="#0d47a1" stroke-width=".3"/>
        <path d="M12.4 3 Q14 2 15 3.4 Q14.4 5 13 4.6 Z M15.6 5.6 Q17.6 5 18.4 6.6 Q16.8 8 15.8 7 Z" fill="#43a047"/>
        <path d="M10.6 5 A4.4 4.4 0 0 0 19.4 5" fill="none" stroke="#c9a227" stroke-width=".5"/><ellipse cx="13.4" cy="3.2" rx="1.2" ry=".7" fill="#fff" opacity=".6"/>`;
    },
    piano: (p) => `<defs>
      <linearGradient id="${p}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4a55"/><stop offset=".3" stop-color="#1b1b1f"/><stop offset="1" stop-color="#0a0a0c"/></linearGradient>
      ${WOOD(p + "w", "#a1887f", "#5d4037", "#3e2723")}</defs>
      <ellipse cx="26" cy="35.6" rx="24" ry="2.4" fill="#000" opacity=".28"/>
      <path d="M6 22 V35 M38 22 V35 M23 24 V35" stroke="#111" stroke-width="1.8"/>
      <path d="M9 14.6 L35 3 L36 4 L10.6 15 Z" fill="#26262c" stroke="#0a0a0c" stroke-width=".3"/><path d="M8.6 15 V3 H10" fill="none" stroke="#2a2a30" stroke-width="1.2"/>
      <path d="M11 14.6 L34.6 4" stroke="#6a6a75" stroke-width=".35"/>
      <path d="M4 14 H34 C44 14 48 16 48 19.6 C48 23.4 40 25 30 25 H4 Z" fill="url(#${p}b)" stroke="#0a0a0c" stroke-width=".5"/>
      <path d="M5 14.4 H34 C42 14.4 46 15.6 47 17.6" fill="none" stroke="#7a7a88" stroke-width=".4"/>
      <rect x="6" y="19.6" width="40" height="3.4" rx=".3" fill="#f5f5f5" stroke="#9e9e9e" stroke-width=".25"/>
      ${Array.from({ length: 13 }, (_, i) => `<rect x="${7.2 + i * 3}" y="19.6" width="1.2" height="2" fill="#1b1b1f"/>`).join("")}
      <rect x="16" y="28" width="18" height="5.4" rx=".8" fill="url(#${p}w)" stroke="#3e2723" stroke-width=".4"/><rect x="16.6" y="28.4" width="16.8" height="1.4" rx=".6" fill="#b71c1c"/>
      <path d="M18.6 33.4 V38 M31.4 33.4 V38" stroke="#3e2723" stroke-width="1.4"/>`,
    sofa: (p, col) => {
      const [c, hi, dk] = col || ["#8e3b46", "#b55462", "#5e2530"];
      return `<defs><linearGradient id="${p}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset=".45" stop-color="${c}"/><stop offset="1" stop-color="${dk}"/></linearGradient></defs>
        <ellipse cx="19" cy="24.8" rx="18" ry="1.6" fill="#000" opacity=".25"/>
        <path d="M3.4 22 V25.6 M34.6 22 V25.6" stroke="#3e2723" stroke-width="1.6"/>
        <rect x="2" y="3.6" width="34" height="11" rx="3" fill="url(#${p}s)" stroke="${dk}" stroke-width=".5"/>
        <rect x="4.4" y="12.6" width="29.2" height="9" rx="1.6" fill="url(#${p}s)" stroke="${dk}" stroke-width=".5"/><path d="M19 13 V21" stroke="${dk}" stroke-width=".5"/>
        <rect x="0" y="9.4" width="6.4" height="13" rx="2.6" fill="url(#${p}s)" stroke="${dk}" stroke-width=".5"/><rect x="31.6" y="9.4" width="6.4" height="13" rx="2.6" fill="url(#${p}s)" stroke="${dk}" stroke-width=".5"/>
        ${[8, 22].map((x) => `<rect x="${x}" y="6.4" width="8" height="6.4" rx="1.6" fill="#fff3c4" stroke="#c9a227" stroke-width=".45" transform="rotate(${x === 8 ? -6 : 6} ${x + 4} 9.6)"/>`).join("")}
        <path d="M4 5 Q19 3.6 34 5" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width=".7"/>`;
    },
    mascot: (p) => `<defs><linearGradient id="${p}s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d6d6d6"/><stop offset=".5" stop-color="#9e9e9e"/><stop offset="1" stop-color="#6f6f6f"/></linearGradient></defs>
      <ellipse cx="20" cy="69.6" rx="19" ry=".9" fill="#000" opacity=".25"/>
      <rect x="2" y="54" width="36" height="16" rx=".8" fill="url(#${p}s)" stroke="#5f5f5f" stroke-width=".5"/>
      <rect x="0" y="51.6" width="40" height="3.4" rx=".8" fill="#bdbdbd" stroke="#7d7d7d" stroke-width=".4"/><rect x=".4" y="51.8" width="39.2" height=".8" fill="#e6e6e6"/>
      <rect x="11" y="58.6" width="18" height="5.4" rx=".6" fill="#c49000"/><rect x="11.6" y="59.2" width="16.8" height="4.2" rx=".4" fill="#ffd54f"/><path d="M${20 - 3} 61.4 l3 -1.2 l3 1.2 l-3 1.2 Z" fill="#a87400"/>
      <g class="st-rock"><path d="M13 53 L12.4 34 Q12.4 28 16 27 L24 27 Q27.6 28 27.6 34 L27 53 Z" fill="#8a8a8a" stroke="#5f5f5f" stroke-width=".5"/><path d="M15 34 L19 33 L18 37 Z" fill="#767676"/></g>
      <image class="st-img" data-base="53" x="0" y="0" width="0" height="0"/>`,
  };

  /**
   * 서울대 정문 — 굵은 철골 셋(ㅅ · ㄷ · ㄱ 을 닮은 문). gx 가운데, base 땅, k 크기, c 색(steel · lite · dark)
   * lite 는 왼쪽 면(빛 받는 쪽) — 노을이면 주황 테두리가 된다
   */
  function snuGate(g, gx, base, k, c) {
    const beam = (x0, y0, x1, y1, t) => {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let i = 0; i <= n; i++) {
        const x = Math.round(x0 + ((x1 - x0) * i) / n), y = Math.round(y0 + ((y1 - y0) * i) / n);
        R(g, x, y, t, t, c.steel); R(g, x, y, 1, t, c.lite); R(g, x + t - 1, y, 1, t, c.dark);
      }
    };
    const u = (v) => Math.round(v * k);
    const top = base - u(62), t = Math.max(4, u(5));
    const L = gx - u(26);
    beam(L - u(4), base - t, L + u(12), top, t); // ㅅ 왼다리
    beam(L + u(10), top + u(22), L + u(22), base - t, t - 1); // ㅅ 오른다리
    beam(L + u(10), top, L + u(42), top, t); // 위 들보
    beam(L + u(36), top, L + u(36), base - t, t); // ㄷ 세로
    beam(L + u(36), top + u(20), L + u(54), top + u(20), t - 1); // ㄷ 가운데
    beam(L + u(36), base - u(14), L + u(54), base - u(14), t - 1); // ㄷ 아래
    for (const x of [L - u(6), L + u(18), L + u(33)]) { R(g, x, base - 3, u(12), 3, c.dark); R(g, x, base - 3, u(12), 1, c.lite); }
  }

  /* ---- 홀 배경 (모금으로 산다) ---- */
  const HALL_THEMES = {
    // 성 — 큰 돌벽, 간판 아래 스테인드글라스 둘, 대리석 체크 바닥
    castle: {
      wall(g) {
        R(g, 0, 0, AW, FLOOR, "#4f566b");
        const r = seeded(5);
        for (let y = 8, row = 0; y < FLOOR - 6; y += 14, row++) for (let x = (row % 2) * -12; x < AW; x += 24) {
          R(g, x, y, 24, 14, "#3d4354"); R(g, x + 1, y + 1, 22, 12, r() < 0.5 ? "#5c6378" : "#565d71"); R(g, x + 1, y + 1, 22, 1, "#6e7690");
        }
        R(g, 0, 0, AW, 8, "#3a2f2a"); R(g, 0, 7, AW, 1, "#241c18");
        const cols = ["#d84343", "#3d73d9", "#f2c94c", "#4caf50", "#b388ff"];
        for (const x of [112, 184]) {
          const w = 24, top = 50, h = 60;
          oval(g, x + w / 2, top + 10, 13, 11, "#2a2230", -11, 0); R(g, x - 1, top + 10, w + 2, h - 10, "#2a2230");
          for (let yy = top + 1; yy < top + h - 1; yy++) for (let xx = x; xx < x + w; xx++) {
            const dy = yy - (top + 10), dx = xx - (x + w / 2);
            if (dy < 0 && (dx * dx) / 144 + (dy * dy) / 100 > 1) continue;
            R(g, xx, yy, 1, 1, cols[(Math.floor((xx - x) / 6) + Math.floor((yy - top) / 8)) % cols.length]);
          }
          for (let yy = top + 8; yy < top + h; yy += 8) R(g, x, yy, w, 1, "#2a2230");
          for (let xx = x + 6; xx < x + w; xx += 6) R(g, xx, top + 2, 1, h - 2, "#2a2230");
          dither(g, x, top, w, h, "#ffffff18");
          R(g, x - 3, top + h - 1, w + 6, 3, "#8a8fa3");
        }
      },
      floor(g) {
        for (let y = FLOOR, r = 0; y < AH; y += 10, r++) for (let x = 0, c = r % 2; x < AW; x += 20, c ^= 1) {
          R(g, x, y, 20, 10, c ? "#d9d4cc" : "#b8b2a8"); R(g, x, y, 20, 1, "#e9e5de");
        }
      },
    },
    // 벚꽃 정원 — 봄 하늘, 먼 산, 벚나무와 나무 울타리, 꽃잎 흩날리는 잔디. 바깥이라 걸레받이 없이
    sakura: {
      outdoor: true,
      wall(g) {
        ["#a7d8f5", "#bfe3f7", "#d6ecf8", "#fbe3ec"].forEach((c, i) => R(g, 0, i * 31, AW, 31, c));
        for (let x = 0; x < AW; x++) { const h = 18 + Math.round(10 * Math.sin(x / 37) + 6 * Math.sin(x / 13)); R(g, x, FLOOR - 26 - h, 1, h, "#9cc9b0"); }
        const r = seeded(21);
        for (const x of [16, 74, 246, 300]) {
          R(g, x - 2, 44, 5, FLOOR - 44, "#6d4c41"); R(g, x - 2, 44, 1, FLOOR - 44, "#8d6e63");
          R(g, x - 8, 60, 7, 2, "#6d4c41"); R(g, x + 3, 54, 8, 2, "#6d4c41");
          for (let i = 0; i < 14; i++) oval(g, x - 18 + Math.floor(r() * 36), 30 + Math.floor(r() * 30), 6 + Math.floor(r() * 4), 5, r() < 0.5 ? "#f8bbd0" : "#f48fb1");
          for (let i = 0; i < 12; i++) R(g, x - 18 + Math.floor(r() * 36), 26 + Math.floor(r() * 36), 1, 1, "#ffffff");
        }
        for (let x = 0; x < AW; x += 12) { R(g, x, FLOOR - 22, 3, 22, "#c8a27a"); R(g, x, FLOOR - 24, 3, 2, "#a1806a"); }
        R(g, 0, FLOOR - 16, AW, 2, "#b08c66"); R(g, 0, FLOOR - 8, AW, 2, "#b08c66");
        R(g, 0, 0, AW, 6, "#f8bbd0"); dither(g, 0, 6, AW, 3, "#f8bbd0");
      },
      floor(g) {
        R(g, 0, FLOOR, AW, AH - FLOOR, "#8fcf7a");
        dither(g, 0, FLOOR, AW, AH - FLOOR, "#7fc06b");
        const r = seeded(8);
        for (let i = 0; i < 70; i++) { const x = Math.floor(r() * AW), y = FLOOR + 4 + Math.floor(r() * (AH - FLOOR - 6)); R(g, x, y, 2, 1, r() < 0.5 ? "#f8bbd0" : "#ffffff"); }
        for (let i = 0; i < 30; i++) { const x = Math.floor(r() * AW), y = FLOOR + 4 + Math.floor(r() * (AH - FLOOR - 6)); R(g, x, y, 1, 2, "#5fae4f"); }
      },
    },
    // 서울대 캠퍼스 — 노을. 보랏빛에서 주황으로 지는 하늘, 지는 해를 등진 정문(ㅅ·ㄷ·ㄱ 철골 문) 실루엣, 불 켜진 학교
    snu: {
      outdoor: true,
      wall(g) {
        const sky = ["#2b2d6e", "#4a3482", "#7a3f8c", "#b04c84", "#e0647a", "#f6906a", "#fbbd78", "#fde0a0"];
        sky.forEach((c, i) => { R(g, 0, i * 14, AW, 14, c); if (i) dither(g, 0, i * 14, AW, 2, sky[i - 1]); });
        const r = seeded(91);
        for (let i = 0; i < 22; i++) R(g, Math.floor(r() * AW), Math.floor(r() * 30), 1, 1, "#ffffffaa");
        for (let k = 34; k > 14; k -= 5) { g.fillStyle = "rgba(255, 220, 150, .12)"; g.beginPath(); g.ellipse(160, 94, k, k, 0, 0, Math.PI * 2); g.fill(); }
        oval(g, 160, 94, 15, 15, "#ffe7ad"); oval(g, 160, 94, 12, 12, "#fff3d0");
        for (let x = 0; x < AW; x++) {
          const far = 30 + Math.round(14 * Math.sin(x / 43 + 2) + 7 * Math.sin(x / 15) + (Math.abs(x - 110) < 34 ? (34 - Math.abs(x - 110)) * 0.8 : 0));
          R(g, x, FLOOR - 16 - far, 1, far, "#8a4f86");
          const near = 18 + Math.round(8 * Math.sin(x / 27 + 1) + 4 * Math.sin(x / 9));
          R(g, x, FLOOR - 14 - near, 1, near, "#5a3566");
        }
        // 학교 건물 — 그림자 덩어리에 불 켜진 창
        const bld = (x, y, w, h) => {
          R(g, x, y, w, FLOOR - y, "#2e2442"); R(g, x, y, w, 1, "#4b3a63");
          for (let yy = y + 4; yy < FLOOR - 6; yy += 5) for (let xx = x + 3; xx < x + w - 3; xx += 4) if (r() < 0.45) R(g, xx, yy, 2, 2, r() < 0.7 ? "#ffd27a" : "#ffeab8");
        };
        bld(40, 78, 40, 46); bld(76, 90, 26, 34); bld(210, 72, 22, 52); bld(256, 84, 44, 40); bld(292, 96, 28, 28);
        for (const x of [24, 118, 202, 300]) { // 가로등 — 둘레가 밝다
          for (let k = 12; k > 3; k -= 3) { g.fillStyle = "rgba(255, 210, 120, .14)"; g.beginPath(); g.ellipse(x + 1, FLOOR - 33, k, k, 0, 0, Math.PI * 2); g.fill(); }
          R(g, x, FLOOR - 32, 2, 32, "#1f1a2e"); R(g, x - 2, FLOOR - 35, 6, 3, "#1f1a2e"); R(g, x - 1, FLOOR - 32, 4, 1, "#fff0c0");
        }
        snuGate(g, 160, FLOOR, 1.35, { steel: "#1f1a2e", lite: "#ff9a6a", dark: "#140f1f" });
      },
      floor(g) {
        R(g, 0, FLOOR, AW, AH - FLOOR, "#6a4256");
        for (let y = FLOOR + 4, row = 0; y < AH; row++) {
          const h = 3 + Math.floor((y - FLOOR) / 16), bw = 8 + Math.floor((y - FLOOR) / 6);
          R(g, 0, y, AW, 1, "#4e2f42");
          for (let k = -14; k <= 14; k++) { const x = Math.round(160 + (k + (row % 2) * 0.5) * bw); if (x >= 0 && x < AW) R(g, x, y + 1, 1, h - 1, "#4e2f42"); }
          y += h;
        }
        // 지는 해가 땅에 깔린 빛 · 앞으로 길게 드리운 그림자
        for (let y = FLOOR; y < FLOOR + 20; y++) { g.fillStyle = `rgba(255, 170, 110, ${0.28 * (1 - (y - FLOOR) / 20)})`; g.fillRect(0, y, AW, 1); }
        dither(g, 0, FLOOR, AW, 2, "#ffb07a66");
        dither(g, 0, AH - 30, AW, 30, "#1f1a2e33");
      },
    },
    // 하늘 신전 — 하늘과 구름, 흰 기둥, 금줄 대리석
    temple: {
      wall(g) {
        ["#7ec8f7", "#9ad6fa", "#b7e3fb", "#d4effd"].forEach((c, i) => R(g, 0, i * 31, AW, 31, c));
        const r = seeded(12);
        for (let i = 0; i < 9; i++) { const x = Math.floor(r() * AW), y = 20 + Math.floor(r() * 80); oval(g, x, y, 14, 4, "#ffffff"); oval(g, x + 9, y - 3, 9, 4, "#ffffff"); oval(g, x - 4, y + 1, 10, 3, "#eef8ff"); }
        for (const x of [4, 98, 210, 304]) {
          R(g, x, 10, 12, FLOOR - 10, "#f5f3ee"); R(g, x + 2, 10, 2, FLOOR - 10, "#ffffff"); R(g, x + 9, 10, 2, FLOOR - 10, "#d8d3c6");
          for (let xx = x + 3; xx < x + 10; xx += 3) R(g, xx, 12, 1, FLOOR - 14, "#e6e1d6");
          R(g, x - 2, 6, 16, 5, "#e0c068"); R(g, x - 2, 6, 16, 1, "#fff0b8");
        }
        R(g, 0, 0, AW, 6, "#f5f3ee"); R(g, 0, 5, AW, 1, "#e0c068");
      },
      floor(g) {
        for (let y = FLOOR, r = 0; y < AH; y += 12, r++) {
          for (let x = (r % 2) * 12; x < AW; x += 24) { R(g, x, y, 24, 12, r % 2 ? "#f5f3ee" : "#ebe7dd"); R(g, x, y, 1, 12, "#d8d3c6"); }
          R(g, 0, y, AW, 1, "#e0c068");
        }
        const r2 = seeded(3);
        for (let i = 0; i < 6; i++) oval(g, Math.floor(r2() * AW), AH - 4, 16, 4, "#ffffffcc");
      },
    },
  };

  function paintHall(Rm, d) {
    const per = period("hall");
    const night = per === "night";
    const col = guildColor(d.code);
    const hall = d.hall || {};
    const has = (id) => (hall.owned || []).includes(id); // 모금으로 다 모인 장식
    const T = HALL_THEMES[hall.theme];
    const [base, g] = canvas(AW, AH);
    (T ? T.wall : hallWall)(g);
    // 걸레받이 — 바깥 배경(outdoor)은 땅이 그대로 이어져서 두지 않는다
    if (!(T && T.outdoor)) { R(g, 0, FLOOR - 6, AW, 6, "#5f574e"); R(g, 0, FLOOR - 6, AW, 1, "#7a7268"); R(g, 0, FLOOR - 1, AW, 1, "#4a433b"); }
    (T ? T.floor : hallFloor)(g);
    dither(g, 0, FLOOR, AW, 3, "#0000002e");
    // 융단 · 깃발 · 간판 · 게시판/전광판 · 횃불 · 등불 · 샹들리에 · 수족관 · 트로피 진열장은 hallDecorSvg(아래 html)
    const mark = MARKS[hall.mark] ? hall.mark : "star";
    const goal = d.goal;
    const board = has("billboard"); // 전광판 — 이번 주 목표 진행(🥇 를 끝으로)
    if (per !== "day") { g.fillStyle = night ? "rgba(10, 14, 40, .3)" : "rgba(60, 20, 40, .1)"; g.fillRect(0, 0, AW, AH); }

    const html = [];
    // 🌤️ 길드 홀에도 방과 같은 조명 · 걸레받이(바깥 배경은 걸레받이 없이). 창이 없어 창빛은 없다
    html.push(roomLightSvg(T && T.outdoor ? "digital" : "hall", { trim: ["#5f574e", "#4a433b", "#7a7268"] }, per, false));
    html.push(hallDecorSvg({ col, mark, has, night, board, goal, golds: hall.golds || 0, outdoor: !!(T && T.outdoor) }));
    // 바닥에 서는 것 — 하나씩 입체 SVG(HALL_SVG), 포켓몬과 앞뒤를 가린다
    const item = (id, x, y, w, h, svg) => html.push(`<div class="rm-f rm-fs rm-anim" data-h="${id}" style="left:${X(x)}%; top:${Y(y)}%; width:${X(w)}%; height:${Y(h)}%; z-index:${(y + h) * 10};"><svg viewBox="0 0 ${w} ${h}" aria-hidden="true">${svg("hs" + ++wallUid)}</svg></div>`);
    item("fountain", HALL.fountain.x, HALL.fountain.y, HALL.fountain.w, HALL.fountain.h, (q) => HALL_SVG.fountain(q, has("goldFountain")));
    for (const id of ["treeL", "treeR"]) item(id, HALL[id].x, HALL[id].y, HALL[id].w, HALL[id].h, HALL_SVG.tree);
    if (has("mascot")) item("mascot", 210, 98, MASCOT.w, MASCOT.h, HALL_SVG.mascot);
    if (has("bookshelf")) item("bookshelf", 286, 76, SHELF.w, SHELF.h, HALL_SVG.shelf);
    if (has("piano")) item("piano", 40, 128, PIANO.w, PIANO.h, HALL_SVG.piano);
    if (has("sofa")) item("sofa", 251, 142, SOFA.w, SOFA.h, (q) => HALL_SVG.sofa(q, col));
    if (has("flowers")) { item("bedL", 44, 174, 58, 20, (q) => HALL_SVG.bed(q, 9)); item("bedR", 218, 174, 58, 20, (q) => HALL_SVG.bed(q, 10)); }
    html.push(`<i class="rm-spark" style="left:${X(158)}%; top:${Y(122)}%; z-index:1700"></i><i class="rm-spark b" style="left:${X(168)}%; top:${Y(130)}%; right:auto; z-index:1700"></i>`);
    html.push(`<span class="rm-txt sign" style="left:${X(160)}%; top:${Y(30)}%;">${esc(d.guildName || "길드")}</span>`);
    if (board) {
      const MED = ["🥉", "🥈", "🥇"];
      const next = goal ? goal.tiers.findIndex((t) => goal.total < t) : -1;
      const line = !goal ? "이번 주 목표<br>집계 전" : next < 0 ? "이번 주 목표<br>🥇 달성!" : `이번 주 목표<br>${MED[next]} ${Math.floor((goal.total / goal.tiers[next]) * 100)}%`;
      html.push(`<span class="rm-txt lt board" style="left:${X(246)}%; top:${Y(72)}%;">${line}</span>`);
    } else html.push(`<span class="rm-txt lt" style="left:${X(246)}%; top:${Y(99)}%;">${d.notice ? esc(d.notice) : "길드 게시판"}</span>`);
    html.push(`<div class="rm-plate"><b>${esc(d.guildName || "길드")}</b> 길드 홀<br>길드원 ${d.count || 0}명</div>`);

    Rm.el.dataset.theme = "hall";
    Rm.el.dataset.per = per;
    const layer = Rm.el.querySelector(".rm-scene");
    layer.innerHTML = "";
    base.className = "rm-base";
    layer.appendChild(base);
    layer.insertAdjacentHTML("beforeend", html.join(""));
    Rm.coin = [];
    const masc = layer.querySelector('.rm-fs[data-h="mascot"]');
    if (masc) {
      // 석상 그림이 늦게 오면 끼운다 — 방의 전설 석상과 같은 줄(id "statue", COIN_TICK.statue)
      const k = { id: "statue", f: MASCOT, svg: masc.querySelector("svg"), dexId: hall.mascot || null };
      Rm.coin.push(k);
      drawCoin(k, frame);
    }
    Rm.scene = { on: new Set(["fountain"]), per, theme: "hall", hall: true };
  }

  function paintScene(Rm, d) {
    const dg = document.body.classList.contains("world-digimon"); // 🦖 디지털 월드 — 가구 그림이 다르다(FURN_DG)
    const on = new Set((d.furni || []).filter((id) => FURN[id] || COIN[id] || ["window", "rug", "poster"].includes(id)));
    const theme = THEMES[d.theme] ? d.theme : "cabin";
    // 🌳 바깥 들판(digital)은 벽이 아니라 하늘이다 — 창문을 걸면 하늘에 창틀이 떠 있었다. 산 창문은 그대로 두고 여기서만 안 그린다
    if (theme === "digital") on.delete("window");
    const per = period(theme);
    const T = THEMES[theme];
    const dex = d.dex || { seen: 0, total: 0 };
    const posOf = (id, f) => (d.pos && d.pos[id]) || [f.x, f.y]; // 끌어 옮긴 자리 — 없으면 정해 둔 자리

    const [base, g] = canvas(AW, AH);
    T.wall(g);
    trim(g, T);
    T.floor(g);
    dither(g, 0, FLOOR, AW, 3, "#0000002e"); // 벽 아래 그늘
    // 🦖 디지털 월드의 바깥 들판 — 벽 장식 뒤에 도트 게시판(포켓몬 방은 fieldBoardSvg)
    if (theme === "digital" && dg) fieldBoardPixel(g, [...wallDeco(on, d), ...Object.entries(placeCoin(on, d, posOf)).filter(([id]) => COIN[id].wall).map(([, r]) => r)]);
    if (on.has("window")) (dg ? drawWindow(g, theme, per) : sky(g, 29, 27, 58, 44, theme, per)); // 포켓몬 방은 하늘만 — 창틀 · 커튼은 windowSvg
    if (dg) drawDexFrame(g); // 🦖 디지바이스는 도트. 포켓몬 방의 액자 · 포스터 · 트로피 · 주간 메달은 SVG(dexFrameSvg …)로 얹는다
    if (d.wins > 0 && dg) drawBadges(g, d.wins); // 포켓몬 방은 caseSvg(입체 진열장 틀)
    if (on.has("poster") && dg) drawSign(g);
    if (d.badges > 0 && dg) drawGymBadges(g, d.champ || 0);
    if (on.has("rug") && dg) drawFlowerBed(g); // 포켓몬 방의 러그는 rugSvg
    // 밤이면 방이 어두워지고 램프 둘레만 밝다
    if (per === "night" || per === "evening") {
      g.fillStyle = per === "night" ? "rgba(10, 14, 40, .32)" : "rgba(60, 20, 40, .12)";
      g.fillRect(0, 0, AW, AH);
    }
    if (on.has("lamp")) {
      const a = per === "night" ? 0.3 : 0.14;
      const [lx, ly] = posOf("lamp", FURN.lamp);
      const glow = dg ? "127, 243, 255" : "255, 220, 140"; // 데이터 등불은 푸른 빛
      for (let r = 34; r > 4; r -= 6) { g.fillStyle = `rgba(${glow}, ${a / 3})`; g.beginPath(); g.ellipse(lx + 9, ly + 10, r, r * 0.85, 0, 0, Math.PI * 2); g.fill(); }
    }

    const html = [];
    for (const id of ["lamp", "bed", "aquarium", "tv", "desk", "shelf", "plant", "cushion"]) {
      if (!on.has(id)) continue;
      const f = FURN[id];
      const [x, y] = posOf(id, f);
      const at = `data-f="${id}" data-move="floor" data-x="${x}" data-y="${y}" data-w="${f.w}" data-h="${f.h}" style="left:${X(x)}%; top:${Y(y)}%; width:${X(f.w)}%; height:${Y(f.h)}%; z-index:${(y + f.h) * 10};"`;
      // 포켓몬 방은 입체 SVG(FURN_SVG), 🦖 디지털 월드는 도트 캔버스(FURN_DG · FURN.draw)
      html.push(dg ? `<canvas class="rm-f" ${at} width="${f.w}" height="${f.h}"></canvas>` : `<div class="rm-f rm-fs" ${at}><svg viewBox="0 0 ${f.w} ${f.h}" aria-hidden="true">${FURN_SVG[id]("fs" + ++wallUid)}</svg></div>`);
    }
    if (!dg && on.has("window")) html.push(windowSvg());
    if (!dg && on.has("rug")) html.push(rugSvg());
    const pl = placeCoin(on, d, posOf);
    for (const [id, [x, y, w, h]] of Object.entries(pl)) {
      const z = COIN[id].wall ? 5 : COIN[id].flat ? 2 : (y + h) * 10;
      const move = COIN[id].wall ? "wall" : COIN[id].flat ? "flat" : "floor";
      const at = `data-c="${id}" data-move="${move}" data-x="${x}" data-y="${y}" data-w="${w}" data-h="${h}" style="left:${X(x)}%; top:${Y(y)}%; width:${X(w)}%; height:${Y(h)}%; z-index:${z};"`;
      const hush = id === "jukebox" && hushJukebox(pl, on, d) ? " hush" : ""; // 음표가 벽 장식 위로 가면 끈다
      html.push(dg ? `<canvas class="rm-f" ${at} width="${w}" height="${h}"></canvas>` : `<div class="rm-f rm-fs rm-coin rm-anim${hush}" ${at}><svg viewBox="0 0 ${w} ${h}" aria-hidden="true">${COIN_SVG[id]("cs" + ++wallUid)}</svg></div>`);
    }
    if (on.has("aquarium") && !dg) {
      // 물고기는 움직여야 해서 따로 얹는다(디지털 월드의 같은 자리는 공중전화 부스라 없다)
      const [ax, ay] = posOf("aquarium", FURN.aquarium);
      html.push(`<i class="rm-fish" style="left:${X(ax + 4)}%; top:${Y(ay + 8)}%; --sw:${X(26)}cqw;"></i><i class="rm-fish b" style="left:${X(ax + 6)}%; top:${Y(ay + 15)}%; --sw:${X(22)}cqw;"></i>`);
    }
    html.push(roomLightSvg(theme, T, per, on.has("window")));
    // 🌳 바깥 들판 — 벽이 없으니 벽 장식 · 벽에 거는 코인 가구 뒤에 나무 게시판을 세운다(도트인 디지털 월드는 그대로)
    if (theme === "digital" && !dg) html.push(fieldBoardSvg([...wallDeco(on, d), ...Object.entries(pl).filter(([id]) => COIN[id].wall).map(([, r]) => r)]));
    // 결투 메달 · 체육관 배지 진열장의 틀 — 입체(들판 게시판 앞에 서야 해서 캔버스가 아니라 여기)
    if (!dg && d.wins > 0) html.push(caseSvg(DUB, d.wins >= 100, "duel"));
    if (!dg && d.badges > 0) html.push(caseSvg(GYB, (d.champ || 0) > 0, "gym"));
    // 벽 장식 — 입체 SVG(디지털 월드의 디지바이스 · 간판만 도트)
    if (!dg) html.push(dexFrameSvg());
    if (on.has("poster") && !dg) html.push(posterSvg());
    if (d.graduated > 0 || d.champ > 0) html.push(trophySvg(d.graduated || 0, d.champ || 0));
    if (d.weekTop > 0) html.push(weekMedalSvg(d.weekTop));
    // 글자 — 캔버스에 쓰면 뭉개진다
    html.push(`<span class="rm-txt${dg ? " lcd" : ""}" style="left:${X(116)}%; top:${Y(dg ? 39 : 41)}%;">${dex.seen}/${dex.total}</span>`);
    if (d.wins > 0) {
      // 🏅 결투 메달 — 딴 것은 메달, 못 딴 칸은 점선 자리만
      const cells = BADGE_AT.map((n, i) => `<i>${duelMedal(i, d.wins >= n)}</i>`).join("");
      html.push(`<div class="rm-dub" style="left:${X(DUB.x + 2)}%; top:${Y(DUB.y + 2)}%; width:${X(DUB.w - 4)}%; height:${Y(DUB.h - 3)}%;">${cells}</div>`);
      html.push(`<span class="rm-txt lt" style="left:${X(DUB.x + DUB.w / 2)}%; top:${Y(DUB.y + DUB.h + 3)}%;">결투 ${d.wins}승</span>`);
    }
    if (d.champ > 3) html.push(`<span class="rm-txt sm cup" style="left:${X(255)}%; top:${Y(33)}%;">🏆×${d.champ}</span>`); // 트로피는 셋까지 — 넘으면 수를 적는다
    if (d.graduated > 0) {
      html.push(`<span class="rm-txt sm" style="left:${X(292)}%; top:${Y(44)}%;">졸업<br>${esc(d.lastGrad || "")}</span>`);
      // 🎓 졸업장 더미를 누르면 목록(내 방만 — room.css 가 #rmRoom 에서만 누를 수 있게 한다)
      html.push(`<button class="rm-hot" data-grads title="졸업장 ${d.graduated}장 보기" style="left:${X(278)}%; top:${Y(22)}%; width:${X(38)}%; height:${Y(38)}%;"></button>`);
    }
    if (d.badges > 0) {
      // 배지 그림 — 체육관 탭의 배지 그대로. 못 딴 칸은 점선 자리만
      const art = window.ptbGymArt;
      const cells = GYM_IDS.map((id, i) => `<i>${art ? art.badge(id, i < d.badges, 40) : ""}</i>`).join("");
      html.push(`<div class="rm-gyb" style="left:${X(GYB.x + 2)}%; top:${Y(GYB.y + 2)}%; width:${X(GYB.w - 4)}%; height:${Y(GYB.h - 4)}%;">${cells}</div>`);
      html.push(`<span class="rm-txt lt" style="left:${X(GYB.x + GYB.w / 2)}%; top:${Y(GYB.y + GYB.h + 4)}%;">배지 ${d.badges}/8</span>`); // 챔피언 횟수는 기록 선반의 트로피가 보인다
    }
    html.push(`<div class="rm-plate"><b>${esc(d.trainer || "나")}</b>의 ${d.theme === "digital" ? "디지털 월드" : "방"}<br>도감 ${dex.seen} · 졸업 ${d.graduated || 0}</div>`);

    Rm.el.dataset.theme = theme;
    Rm.el.dataset.per = per; // 밤이면 가구·아이들도 같이 어두워진다(room.css)
    const layer = Rm.el.querySelector(".rm-scene");
    layer.innerHTML = "";
    base.className = "rm-base";
    layer.appendChild(base);
    layer.insertAdjacentHTML("beforeend", html.join(""));
    Rm.coin = [];
    for (const c of layer.querySelectorAll(".rm-coin")) { // SVG 코인 가구 — 시계 · 석상만 타이머가 고친다
      const k = { id: c.dataset.c, f: COIN[c.dataset.c], svg: c.querySelector("svg"), dexId: d.statue || null };
      Rm.coin.push(k);
      drawCoin(k, frame);
    }
    for (const c of layer.querySelectorAll("canvas.rm-f")) {
      const g2 = c.getContext("2d");
      g2.imageSmoothingEnabled = false;
      if (c.dataset.f) (dg && FURN_DG[c.dataset.f] ? FURN_DG[c.dataset.f] : FURN[c.dataset.f].draw)(g2);
      else {
        const k = { id: c.dataset.c, f: COIN[c.dataset.c], g: g2, dexId: d.statue || null };
        Rm.coin.push(k);
        drawCoin(k, frame);
      }
    }
    Rm.scene = { on, per, theme, spots: coinSpots(pl), spot: candySpots(posOf) };
  }

  /** 벽과 바닥 사이 띠 */
  function trim(g, T) {
    R(g, 0, FLOOR - 6, AW, 6, T.trim[0]); R(g, 0, FLOOR - 6, AW, 1, T.trim[2]); R(g, 0, FLOOR - 1, AW, 1, T.trim[1]);
  }

  /* ================= 포켓몬 ================= */

  const rand = (a, b) => a + Math.random() * (b - a);
  const nightish = (Rm) => Rm.scene && Rm.scene.per === "night";

  function hPct(a) { return a.h * 1.6; } // 방은 16:10 — 너비 1% 는 높이 1.6%

  function place(a) {
    a.el.style.left = a.x + "%";
    // GIF 아래쪽에 빈칸이 있어서 발이 닿도록 조금 내린다
    a.el.style.top = a.y - hPct(a) * 0.92 + "%";
    a.el.style.zIndex = a.z != null ? a.z : Math.round(a.y * 2 * 10); // y% × 2 = 그림 좌표
    a.body.classList.toggle("r", a.face < 0);
    a.el.classList.toggle("tagup", a.y > 88); // 바닥 끝에 서면 이름표를 머리 위로 — 아래로는 잘린다
  }

  function say(a, text, ms = 1800, cls = "") {
    a.bub.textContent = text;
    a.bub.className = "rm-bub on " + cls;
    clearTimeout(a.bubT);
    if (ms) a.bubT = setTimeout(() => (a.bub.className = "rm-bub"), ms);
  }

  function makeActor(Rm, m) {
    const el = document.createElement("div");
    el.className = "rm-mon";
    el.innerHTML = `<div class="rm-body"><img alt=""><div class="rm-shadow"></div></div><div class="rm-bub"></div><div class="rm-tag"></div>`;
    const a = {
      R: Rm, id: m.id, el, body: el.querySelector(".rm-body"), img: el.querySelector("img"), bub: el.querySelector(".rm-bub"), tag: el.querySelector(".rm-tag"),
      x: rand(WALK.x0, WALK.x1), y: rand(WALK.y0, WALK.y1), tx: 0, ty: 0, face: Math.random() < 0.5 ? 1 : -1,
      state: "idle", t: rand(0.3, 2), goal: null, cool: rand(4, 10), z: null, h: 12, small: false,
    };
    el.addEventListener("click", () => poke(a));
    Rm.el.querySelector(".rm-actors").appendChild(el);
    return a;
  }

  function dress(a, m) {
    a.h = SIZE[m.stageKey] || 12;
    a.small = m.stageKey === "baby" || m.stageKey === "mid";
    a.types = (m.profile && m.profile.typeKeys) || []; // 불 타입은 벽난로, 물 타입은 연못에 잘 간다
    a.el.style.setProperty("--h", a.h);
    const src = m.animUrl || m.url || "";
    if (a.img.getAttribute("src") !== src) a.img.src = src;
    const lv = m.profile ? ` · Lv.${m.profile.level}` : "";
    a.tag.textContent = `${m.owner ? m.owner + "의 " : ""}${m.name}${m.shiny ? " ★" : ""}${lv}${m.active ? " · 키우는 중" : ""}`;
    let own = a.el.querySelector(".rm-own");
    if (m.badge && !own) { a.el.insertAdjacentHTML("beforeend", '<div class="rm-own"></div>'); own = a.el.querySelector(".rm-own"); }
    if (own) { own.hidden = !m.badge; own.textContent = m.badge || ""; own.classList.toggle("me", Boolean(m.me)); }
    a.el.classList.toggle("shiny", Boolean(m.shiny));
    if (m.shiny && !a.el.querySelector(".rm-spark")) a.el.insertAdjacentHTML("beforeend", '<i class="rm-spark"></i><i class="rm-spark b"></i>');
    place(a);
  }

  function syncActors(Rm, want) {
    const keep = new Set(want.map((m) => m.id));
    for (const [id, a] of Rm.actors) if (!keep.has(id)) { a.el.remove(); Rm.actors.delete(id); }
    for (const m of want) {
      const a = Rm.actors.get(m.id) || makeActor(Rm, m);
      Rm.actors.set(m.id, a);
      dress(a, m);
    }
    Rm.el.querySelector(".rm-empty").hidden = want.length > 0;
  }

  /** 자리가 사라졌으면(가구를 치웠으면) 하던 일을 그만둔다 */
  function release(Rm) {
    for (const a of Rm.actors.values()) {
      if (["sit", "sleep", "eat", "watch", "dance"].includes(a.state) || a.goal) {
        a.state = "idle"; a.goal = null; a.z = null; a.at = null; a.t = rand(0.2, 1);
        a.el.classList.remove("sit", "sleep", "dance", "heal");
        a.bub.className = "rm-bub";
        if (a.y < WALK.y0) a.y = WALK.y0 + 1;
      }
    }
  }

  const spotsOf = (Rm) => (Rm.scene && Rm.scene.spot) || SPOT; // 가구를 옮겼으면 그 방의 자리
  const busyAt = (Rm, spot) => [...Rm.actors.values()].some((a) => a.goal === spot || a.at === spot);

  function walkTo(a, x, y, goal = null) {
    a.tx = x; a.ty = y; a.goal = goal; a.state = "walk"; a.at = null;
    a.el.classList.remove("sit", "sleep");
    a.z = null;
  }

  /** 다음에 무엇을 할까 */
  function decide(a) {
    const Rm = a.R;
    const on = Rm.scene ? Rm.scene.on : new Set();
    const opts = [["walk", 5], ["idle", 1.5]];
    if (on.has("plant") && !busyAt(Rm, "plant")) opts.push(["plant", 1.2]);
    if (on.has("cushion") && a.small && !busyAt(Rm, "cushion")) opts.push(["cushion", 1.3]);
    if (on.has("tv") && !busyAt(Rm, "tv")) opts.push(["tv", 1]);
    if (on.has("fountain")) opts.push(["fountain", 1.4]);
    const sp = (Rm.scene && Rm.scene.spots) || {};
    const free = (k) => sp[k] && !busyAt(Rm, k);
    if (free("beanbag")) opts.push(["beanbag", nightish(Rm) ? 2.5 : 1.2]);
    if (free("jukebox")) opts.push(["jukebox", 1]);
    if (free("arcade")) opts.push(["arcade", 0.7]);
    if (free("arcade2")) opts.push(["arcade2", 0.7]);
    if (sp.fireplace) opts.push(["fireplace", (a.types || []).includes("fire") ? 3 : 0.8]);
    if (sp.pond) opts.push(["pond", (a.types || []).includes("water") ? 3 : 0.7]);
    if (free("healer")) opts.push(["healer", 0.6]);
    if (sp.statue) opts.push(["statue", 0.5]);
    if (free("masterball")) opts.push(["masterball", 0.4]);
    if (!(Rm.scene && Rm.scene.hall)) opts.push(["sleep", nightish(Rm) ? 3.5 : 0.25]);
    let r = Math.random() * opts.reduce((n, o) => n + o[1], 0);
    const pick = opts.find((o) => (r -= o[1]) <= 0)[0];

    if (pick === "walk") {
      let x, y;
      // 홀에서는 분수 뒤에 서지 않는다 — 가려서 누가 누군지 안 보인다
      do { x = rand(WALK.x0, WALK.x1); y = rand(WALK.y0, WALK.y1); } while (Rm.scene && Rm.scene.hall && x > 36 && x < 64 && y < 87);
      walkTo(a, x, y);
    }
    else if (pick === "idle") { a.state = "idle"; a.t = rand(1.5, 4); }
    else if (pick === "sleep") {
      if (on.has("bed") && !busyAt(Rm, "bed")) walkTo(a, spotsOf(Rm).bed.x - 3, spotsOf(Rm).bed.walkY || WALK.y0 + 1, "bed");
      else { a.state = "sleep"; a.t = rand(6, 12); a.el.classList.add("sleep"); say(a, "Z z", 0, "z"); }
    } else if (pick === "fountain") walkTo(a, SPOT.fountain.x + (Math.random() < 0.5 ? -1 : 1) * rand(10, 16), SPOT.fountain.y + rand(-2, 4), "fountain");
    else if (sp[pick]) {
      const s = sp[pick];
      const x = s.alt != null && Math.random() < 0.5 ? s.alt : s.x;
      walkTo(a, x + (s.spread ? rand(-s.spread, s.spread) : 0), s.y, pick);
    }
    else walkTo(a, spotsOf(Rm)[pick].x + rand(-1.5, 1.5), spotsOf(Rm)[pick].y, pick);
  }

  function arrive(a) {
    const goal = a.goal;
    a.goal = null;
    if (!goal) { a.state = "idle"; a.t = rand(1, 3.5); return; }
    a.at = goal;
    const S = spotsOf(a.R);
    if (goal === "plant") { a.state = "eat"; a.t = rand(3, 5); a.face = S.plant.face; say(a, "냠냠", 2600); }
    else if (goal === "cushion") { a.state = "sit"; a.t = rand(6, 12); a.x = S.cushion.x; a.y = S.cushion.y; a.z = S.cushion.z || 1910; a.el.classList.add("sit"); }
    else if (goal === "tv") { a.state = "watch"; a.t = rand(5, 9); a.face = 1; say(a, "♪", 2000); }
    else if (goal === "fountain") { a.state = "watch"; a.t = rand(3, 6); a.face = a.x > SPOT.fountain.x ? 1 : -1; say(a, Math.random() < 0.5 ? "✨" : "♪", 1800); }
    else if (goal === "bed") {
      a.state = "sleep"; a.t = nightish(a.R) ? rand(14, 26) : rand(6, 10);
      a.x = S.bed.x; a.y = S.bed.y; a.z = S.bed.z || 1345; a.face = 1;
      a.el.classList.add("sleep"); say(a, "Z z", 0, "z");
    } else coinArrive(a, goal);
  }

  /** 코인 가구 앞에 닿았다 */
  function coinArrive(a, goal) {
    const s = ((a.R.scene && a.R.scene.spots) || {})[goal];
    if (!s) { a.state = "idle"; a.t = rand(1, 3); return; }
    const toward = () => (s.cx != null ? (a.x > s.cx ? 1 : -1) : s.face || 1);
    if (goal === "beanbag") {
      // 빈백 위에 올라간다 — 크기 상관없이. 밤이면 거의 잔다
      const sleep = nightish(a.R) || Math.random() < 0.5;
      a.state = sleep ? "sleep" : "sit"; a.t = sleep ? rand(10, 20) : rand(6, 12);
      a.x = s.x; a.y = s.y; a.z = s.z;
      a.el.classList.add(sleep ? "sleep" : "sit");
      if (sleep) say(a, "Z z", 0, "z");
    } else if (goal === "jukebox") {
      a.state = "dance"; a.t = rand(4, 7); a.face = s.face; a.el.classList.add("dance"); say(a, "♪♫", 2600);
    } else if (goal === "arcade" || goal === "arcade2") {
      a.state = "watch"; a.t = rand(5, 9); a.face = s.face; say(a, "삑삑", 1800);
    } else if (goal === "fireplace") {
      a.state = "sit"; a.t = rand(6, 11); a.el.classList.add("sit"); say(a, "따뜻해", 2200);
    } else if (goal === "pond") {
      a.state = "watch"; a.t = rand(3, 5); a.face = toward();
      a.el.classList.remove("jump"); void a.el.offsetWidth; a.el.classList.add("jump");
      say(a, "첨벙!", 1600);
    } else if (goal === "healer") {
      a.state = "watch"; a.t = rand(3, 4.5); a.face = s.face; a.el.classList.add("heal"); say(a, "띠링~♪", 2000, "heart");
    } else {
      a.state = "watch"; a.t = rand(2.5, 4); a.face = toward(); say(a, "✨", 1600); // 석상 · 마스터볼 구경
    }
  }

  function poke(a) {
    a.el.classList.remove("jump");
    void a.el.offsetWidth; // 다시 누르면 다시 뛴다
    a.el.classList.add("jump");
    a.el.classList.add("show");
    clearTimeout(a.tagT);
    a.tagT = setTimeout(() => a.el.classList.remove("show"), 2500);
    if (a.state === "sleep") { say(a, "!?", 1400); a.state = "idle"; a.t = 1.2; a.at = null; a.z = null; a.el.classList.remove("sleep"); if (a.y < WALK.y0) a.y = WALK.y0 + 1; }
    else say(a, "!", 1000);
  }

  function step(a, dt) {
    if (a.state === "walk") {
      const dx = a.tx - a.x, dy = (a.ty - a.y) / 1.6; // 세로 % 는 화면에서 더 짧다
      const d = Math.hypot(dx, dy);
      const v = 7 * dt; // 초당 방 너비의 7%
      if (Math.abs(dx) > 0.3) a.face = dx < 0 ? 1 : -1;
      if (d <= v) { a.x = a.tx; a.y = a.ty; arrive(a); }
      else { a.x += (dx / d) * v; a.y += ((dy / d) * v) * 1.6; }
      a.body.classList.add("walking");
    } else {
      a.body.classList.remove("walking");
      a.t -= dt;
      if (a.t <= 0) {
        const wasAt = a.at;
        a.at = null;
        if (a.state === "sleep") { a.bub.className = "rm-bub"; a.el.classList.remove("sleep"); }
        if (a.state === "sit") a.el.classList.remove("sit");
        a.el.classList.remove("dance", "heal");
        a.z = null;
        if (wasAt === "bed") a.y = WALK.y0 + 1;
        decide(a);
      }
    }
    a.cool -= dt;
    place(a);
  }

  /** 가까이 마주치면 서로 본다 — 하트나 음표 */
  function meet(Rm) {
    const list = [...Rm.actors.values()].filter((a) => (a.state === "walk" || a.state === "idle") && a.cool <= 0);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (Math.abs(a.x - b.x) < 9 && Math.abs(a.y - b.y) < 5) {
        const mark = Math.random() < 0.6 ? "♥" : "♪";
        for (const [p, q] of [[a, b], [b, a]]) {
          p.state = "idle"; p.goal = null; p.t = rand(1.8, 2.6); p.cool = rand(12, 20);
          p.face = q.x < p.x ? 1 : -1;
          say(p, mark, 2000, mark === "♥" ? "heart" : "");
        }
        return;
      }
    }
  }

  let lastT = 0;
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - lastT) / 1000 || 0);
    lastT = now;
    for (const Rm of rooms) {
      if (!Rm.actors.size || !Rm.el.offsetParent) continue; // 안 보이는 방은 쉰다
      for (const a of Rm.actors.values()) step(a, dt);
      meet(Rm);
    }
  }
  requestAnimationFrame(tick);

  // 길드 화면(guild.js)이 길드원의 방을 그릴 때 쓴다
  /** 길드 마크 단추 그림 — 길드 색 바탕에 방패와 마크(길드 화면이 쓴다) */
  function markIcon(id, code) {
    const [c, , dk] = guildColor(code);
    const [cv, g] = canvas(20, 22);
    R(g, 0, 0, 20, 22, c); R(g, 0, 21, 20, 1, dk);
    shield(g, 3, 3, id, c);
    return cv.toDataURL();
  }

  /** ⚔️ 필드 배틀(digibattle.js)의 전장 — 가구 없는 디지털 초원 한 장 */
  function paintField() {
    const [c, g] = canvas(AW, AH);
    const T = THEMES.digital;
    T.wall(g);
    trim(g, T);
    T.floor(g);
    dither(g, 0, FLOOR, AW, 3, "#0000002e");
    return c;
  }

  window.ptbRoom = { create, markIcon, paintField, MARK_IDS: Object.keys(MARKS), FURN_IDS: [...Object.keys(FURN), ...Object.keys(COIN)] };

  /* ================= 내 방 ================= */

  const mine = create($("rmRoom"));
  // 빈 방 글은 index.html 의 #rmEmpty 그대로 — "포켓몬/디지몬"(.mw)은 세계에 따라 app.js 가 바꾼다
  const BADGE_NOTE = [1, 10, 30, 100];

  function renderPanel(s) {
    const R0 = s.room;
    const left = s.candy ? s.candy.left : 0;
    const cu = (window.ptbCur ? window.ptbCur() : { name: "사탕", icon: "🍬", time: "사탕 타임" }); // 🍬 사탕 · 💠 비트
    $("rmWallet").textContent = cu.icon + " " + left;
    $("rmTags").classList.toggle("on", Boolean(R0.tags));
    document.body.classList.toggle("rm-tags-on", Boolean(R0.tags)); // 길드원 방을 볼 때도
    $("rmReset").disabled = !Object.keys(R0.pos || {}).length;

    // 코인 꾸미기는 산 것만 위 목록에 섞이고, 안 산 것은 아래 코인 칸에 따로 보인다
    $("rmThemes").innerHTML = R0.themes
      .filter((t) => !t.coin || t.owned)
      .map((t) => t.owned
        ? `<button data-theme="${t.id}" class="${t.id === R0.theme ? "on" : ""}">${t.icon} ${t.name}</button>`
        : `<button data-buy-theme="${t.id}" ${left < t.cost ? "disabled" : ""}>${t.icon} ${t.name}<span class="c">${cu.icon}${t.cost}</span></button>`)
      .join("");

    $("rmFurni").innerHTML = R0.furni
      .filter((f) => !f.coin || f.owned)
      .map((f) => `<div class="it${f.coin ? " coin" : ""}"><span class="ic">${f.icon}</span><span class="t">${f.name}<span>${f.desc}</span></span>${
        f.owned
          ? `<button data-toggle="${f.id}">${f.on ? "치우기" : "놓기"}</button>`
          : `<button class="buy" data-buy-furni="${f.id}" ${left < f.cost ? "disabled" : ""}>${cu.icon}${f.cost}</button>`
      }</div>`)
      .join("");

    renderCoins(R0);

    const dex = s.dex || { seen: 0, total: 0 };
    const next = BADGE_NOTE.find((n) => R0.wins < n);
    $("rmRec").innerHTML = [
      `🖼️ <b>도감 액자</b> — 도감 ${dex.seen}/${dex.total}. 만날수록 숫자가 오른다`,
      `🎖️ <b>결투 메달 진열장</b> — ${R0.wins}승${next ? ` · ${next}승이면 ${["동", "은", "금", "루비"][BADGE_NOTE.indexOf(next)]} 메달이 걸린다` : " · 동 · 은 · 금 · 루비 메달을 다 모았다"}`,
      `🎓 <b>졸업장</b> — ${R0.graduated ? `${R0.graduated}마리 졸업 (마지막: ${esc(R0.lastGrad)}) · 한 마리마다 한 장씩 쌓이고, 누르면 목록이 열린다` : "마스터까지 키우면 생긴다"}`,
      `🏆 <b>챔피언 트로피</b> — ${R0.champ ? `챔피언 로드 우승 ${R0.champ}번 · 우승할 때마다 트로피가 하나씩 선다` : "챔피언 로드에서 우승하면 생긴다"}`,
      `🏅 <b>주간 1위 메달</b> — ${R0.weekTop ? `${R0.weekTop}번 · 아래 띠에 한 번마다 금줄이 하나씩 쌓이고 다섯 줄이면 별이 된다` : "길드에서 한 주 동안 토큰을 가장 많이 쓰면 생긴다"}`,
      `🏟️ <b>체육관 배지 진열장</b> — ${R0.badges ? `배지 ${R0.badges}/8${R0.champ ? ` · 🏆 챔피언 ${R0.champ}번 (금테 진열장)` : R0.badges >= 8 ? " · 챔피언 로드에서 챔피언이 되면 진열장이 금테가 된다" : ""}` : "배틀 탭 › 체육관에서 첫 배지를 따면 생긴다"}`,
    ].join("<br>");

    renderTitles(s.titles);

    const pickable = (s.box || []).filter((m) => m.stageKey !== "egg");
    const inRoom = new Set(R0.mons);
    $("rmMonsCount").textContent = `${R0.mons.length}/${R0.max}`;
    $("rmMons").innerHTML = pickable
      .map((m) => `<button data-mon="${m.id}" class="${inRoom.has(m.id) ? "on" : ""}" ${!inRoom.has(m.id) && R0.mons.length >= R0.max ? "disabled" : ""}>${m.url ? `<img src="${esc(m.url)}" alt="">` : ""}${esc(m.name)}</button>`)
      .join("") || '<span class="rm-rec">알만 있습니다. 부화하면 방에 둘 수 있습니다.</span>';
  }

  /** 코인 꾸미기 — 아직 안 산 것. 잔액은 서버 값이라 방 탭을 열 때 다시 받는다(roomCoins) */
  function renderCoins(R0) {
    const coins = R0.coins;
    const wallet = $("rmCoins");
    wallet.textContent = "🪙 " + (coins == null ? "–" : coins);
    wallet.classList.add("coin");
    const themes = R0.themes.filter((t) => t.coin && !t.owned);
    const furni = R0.furni.filter((f) => f.coin && !f.owned);
    const can = (it) => R0.online && coins != null && coins >= it.cost && (it.needs !== "legend" || R0.hasLegend);
    const cheapest = Math.min(...[...themes, ...furni].map((it) => it.cost));
    $("rmCoinNote").textContent = !R0.online
      ? "설정 › 온라인 기능을 켜야 살 수 있습니다. 코인은 서버 지갑에 있습니다"
      : !themes.length && !furni.length
        ? "코인 꾸미기를 다 모았습니다"
        : coins == null || coins < cheapest
          ? "코인은 상점 탭 › 🛒 길드 몰에서 출석 · 사탕 환전 · 상점에 팔기로 모읍니다"
          : "산 것은 위 배경 · 가구 목록에 들어갑니다. 되팔 수 없습니다";
    $("rmCoinThemes").innerHTML = themes
      .map((t) => `<button data-buy-theme="${t.id}" title="${esc(t.desc)}" ${can(t) ? "" : "disabled"}>${t.icon} ${t.name}<span class="c coin">🪙${t.cost}</span></button>`)
      .join("");
    $("rmCoinFurni").innerHTML = furni
      .map((f) => `<div class="it coin"><span class="ic">${f.icon}</span><span class="t">${f.name}<span>${f.needs === "legend" && !R0.hasLegend ? "전설의 포켓몬이 있어야 살 수 있다" : f.desc}</span></span><button class="buy coin" data-buy-furni="${f.id}" ${can(f) ? "" : "disabled"}>🪙${f.cost}</button></div>`)
      .join("");
  }

  /** 한 번 더 눌러야 산다 — 코인은 비싸고 되팔 수 없다 */
  function sure(btn, label) {
    if (btn.dataset.sure === "1") return true;
    btn.dataset.sure = "1";
    const was = btn.innerHTML;
    btn.textContent = label;
    setTimeout(() => { if (btn.isConnected) { btn.dataset.sure = ""; btn.innerHTML = was; } }, 3000);
    return false;
  }

  /** 갱신 값 → 방 그릴 거리 */
  function myRoom(s) {
    const R0 = s.room;
    return {
      theme: R0.theme,
      furni: R0.furni.filter((f) => f.on).map((f) => f.id),
      statue: R0.statue || null,
      pos: R0.pos || {},
      mons: R0.mons.map((id) => (s.box || []).find((m) => m.id === id)).filter(Boolean),
      dex: s.dex || { seen: 0, total: 0 },
      wins: R0.wins,
      graduated: R0.graduated,
      lastGrad: R0.lastGrad,
      weekTop: R0.weekTop || 0,
      badges: R0.badges || 0,
      champ: R0.champ || 0,
      trainer: window.ptbTitled(s.titles && s.titles.on, (s.friend && s.friend.trainer) || "나"), // 🎖️ 단 칭호를 이름 앞에
    };
  }

  /* ---- 패널 탭 — 🎨 꾸미기 · 🐾 포켓몬 · 🎖️ 칭호 · 📜 기록. 한 번에 하나, 고른 탭은 이 PC 에 기억한다 ---- */
  const PT_LS = "ptb.roomTab";
  let titlesOpen = false; // 못 얻은 칭호 펼침
  function ptab(name) {
    if (!["deco", "mons", "titles", "rec"].includes(name)) name = "deco";
    for (const b of document.querySelectorAll("#rmPTabs button")) b.classList.toggle("on", b.dataset.pt === name);
    for (const el of document.querySelectorAll("#rmPanel .rm-pt")) el.hidden = el.dataset.pt !== name;
    if (name !== "deco" && $("rmRoom").classList.contains("edit")) setEdit(false); // 가구 옮기기는 꾸미기 탭에서만
    try { localStorage.setItem(PT_LS, name); } catch {}
  }
  try { ptab(localStorage.getItem(PT_LS) || "deco"); } catch { ptab("deco"); }

  /** 🎖️ 칭호 — 얻은 것이 먼저(얻은 차례), 못 얻은 것은 조건과 지금 몇인지 */
  function renderTitles(T) {
    if (!T) return;
    const got = T.list.filter((t) => t.got).sort((a, b) => a.got - b.got);
    const not = T.list.filter((t) => !t.got);
    const big = (n) => (n >= 1e8 ? `${Math.floor(n / 1e8)}억` : n.toLocaleString());
    $("rmTitleN").textContent = `${got.length}/${T.list.length}`;
    $("rmTitles").innerHTML = got.map((t) => `<button data-title="${t.id}" class="${T.on === t.id ? "on" : ""}" title="${T.on === t.id ? "다시 누르면 뗍니다" : "이름 앞에 달기"}"><span class="i">${t.icon}</span><span class="t">${esc(t.name)}<span>${T.on === t.id ? "달고 있음 · " : ""}${esc(t.desc)}</span></span></button>`).join("")
      || '<span class="rm-rec">아직 얻은 칭호가 없습니다. 아래에서 조건을 보세요.</span>';
    // 못 얻은 칭호 — 접어 둔다(길어서). 펼치면 조건과 지금 몇인지
    $("rmTitleMore").hidden = !not.length;
    $("rmTitleMore").textContent = titlesOpen ? "▾ 못 얻은 칭호 접기" : `▸ 못 얻은 칭호 ${not.length}개 보기`;
    $("rmTitlesNot").hidden = !titlesOpen || !not.length;
    $("rmTitlesNot").innerHTML = not.map((t) => `<button disabled title="${esc(t.desc)}"><span class="i">${t.icon}</span><span class="t">${esc(t.name)}<span>${esc(t.desc)} · ${big(t.now)}/${big(t.at)}</span></span></button>`).join("");
  }

  /* ================= 연결 ================= */

  function renderMine(s) {
    if (!s || !s.room) return;
    last = s;
    mine.render(myRoom(s));
    renderPanel(s);
  }

  // 낮 → 저녁 → 밤이 바뀌면 창밖을 다시 그린다(그림 열쇠에 시간대가 들어 있다)
  setInterval(() => {
    for (const Rm of rooms) if (Rm.data) render(Rm, Rm.data);
  }, 60_000);

  const done = (r) => {
    if (!r || !r.ok) toast((r && r.reason) || "하지 못했습니다", "bad");
    else if (r.message) toast(r.message);
  };

  /* ---- 가구 옮기기 ----
     "✋ 가구 옮기기"를 누르면 방의 가구를 끌 수 있다. 놓으면 그 자리를 세이브에 둔다(roomSet pos).
     바닥 가구는 아랫변이 바닥 안에, 벽에 거는 것(시계 · 네온)은 벽 안에 머문다. */
  const roomEl = $("rmRoom");
  let drag = null;

  /* ---- 🎓 졸업장 목록 ----
     방의 졸업장 더미를 누르면 방 아래에 졸업장 앨범이 열린다. 한 장에 한 마리 — 그림 · 이름 · 희귀도 · 성격 · 졸업한 날.
     최근 졸업이 먼저. 다시 누르거나 ✕ 로 닫는다 */
  const gradsEl = $("rmGrads");
  async function openGrads() {
    if (!gradsEl.hidden) return void (gradsEl.hidden = true);
    const list = await window.ptb.roomGrads().catch(() => []);
    gradsEl.innerHTML = `<div class="rg-head"><b>🎓 졸업장</b> <span>${list.length}장 — 마스터까지 키운 아이들</span><button class="rg-x" data-grads-close title="닫기">✕</button></div>
      <div class="rg-list">${list.map((g) => `<div class="rg-card">
        <div class="rg-no">No.${g.no}</div>
        <div class="rg-pic">${g.url ? `<img src="${esc(g.url)}" alt="">` : "🥚"}</div>
        <div class="rg-name">${esc(g.name)}</div>
        <div class="rg-meta">${"★".repeat(Math.max(0, Math.min(5, g.stars)))}${g.nature ? ` · ${esc(g.nature)}` : ""}</div>
        <div class="rg-at">${esc(g.at)} 졸업</div>
        <i class="rg-seal"></i></div>`).join("") || `<div class="rg-empty">아직 졸업한 아이가 없습니다</div>`}</div>`;
    gradsEl.hidden = false;
    gradsEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  roomEl.addEventListener("click", (e) => {
    if (roomEl.classList.contains("edit") || !e.target.closest("[data-grads]")) return;
    openGrads();
  });
  gradsEl.addEventListener("click", (e) => { if (e.target.closest("[data-grads-close]")) gradsEl.hidden = true; });
  function setEdit(on) {
    roomEl.classList.toggle("edit", on);
    $("rmEdit").classList.toggle("on", on);
    $("rmEdit").textContent = on ? "✓ 다 옮김" : "✋ 가구 옮기기";
    $("rmReset").hidden = !on;
  }
  function dragAt(e) {
    const x = Math.round(drag.x0 + (e.clientX - drag.sx) * drag.k);
    const y = Math.round(drag.y0 + (e.clientY - drag.sy) * drag.k);
    const cx = Math.max(0, Math.min(AW - drag.w, x));
    const cy = drag.move === "wall"
      ? Math.max(0, Math.min(FLOOR - 6 - drag.h, y))
      : Math.max(FLOOR + 6 - drag.h, Math.min(AH - drag.h, y)); // 아랫변이 바닥 안
    return [cx, cy];
  }
  roomEl.addEventListener("pointerdown", (e) => {
    if (!roomEl.classList.contains("edit")) return;
    const c = e.target.closest(".rm-f[data-move]");
    if (!c) return;
    e.preventDefault();
    c.setPointerCapture(e.pointerId);
    drag = { c, id: c.dataset.f || c.dataset.c, move: c.dataset.move, sx: e.clientX, sy: e.clientY, x0: Number(c.dataset.x), y0: Number(c.dataset.y), w: Number(c.dataset.w) || c.width, h: Number(c.dataset.h) || c.height, k: AW / roomEl.getBoundingClientRect().width, at: null };
    c.classList.add("drag");
  });
  // 움직이기 · 놓기는 창 전체에서 듣는다 — 방 밖으로 끌고 나가서 놓아도 놓은 것이다
  window.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const [x, y] = (drag.at = dragAt(e));
    drag.c.style.left = X(x) + "%";
    drag.c.style.top = Y(y) + "%";
    if (drag.move === "floor") drag.c.style.zIndex = (y + drag.h) * 10;
  });
  const drop = async () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.c.classList.remove("drag");
    if (!d.at || (d.at[0] === d.x0 && d.at[1] === d.y0)) return;
    done(await window.ptb.roomSet({ pos: { id: d.id, x: d.at[0], y: d.at[1] } }));
  };
  window.addEventListener("pointerup", drop);
  window.addEventListener("pointercancel", drop);

  // 내 방 이름판을 누르면 🎖️ 칭호 탭으로
  $("rmRoom").addEventListener("click", (e) => {
    if (!e.target.closest(".rm-plate") || $("rmRoom").classList.contains("edit")) return;
    ptab("titles");
    $("rmPTabs").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("rmPanel").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled || !last) return;
    if (b.dataset.tool === "edit") return setEdit(!roomEl.classList.contains("edit"));
    if (b.dataset.tool === "reset") return done(await window.ptb.roomSet({ posReset: true }));
    if (b.dataset.tool === "tags") return done(await window.ptb.roomSet({ tags: !last.room.tags }));
    if (b.dataset.theme) return done(await window.ptb.roomSet({ theme: b.dataset.theme }));
    if (b.dataset.toggle) return done(await window.ptb.roomSet({ toggle: b.dataset.toggle }));
    if (b.dataset.buyTheme || b.dataset.buyFurni) {
      if (b.closest("#rmCoinThemes, #rmCoinFurni") && !sure(b, "정말 사기?")) return;
      b.disabled = true; // 연타로 두 번 사지 않게
      return done(await window.ptb.roomBuy(b.dataset.buyTheme ? { kind: "theme", id: b.dataset.buyTheme } : { kind: "furni", id: b.dataset.buyFurni }));
    }
    if (b.dataset.pt) return ptab(b.dataset.pt);
    if (b.id === "rmTitleMore") { titlesOpen = !titlesOpen; return renderTitles(last.titles); }
    if (b.dataset.title) {
      const off = last.titles && last.titles.on === b.dataset.title;
      const r = await window.ptb.titleSet(off ? null : b.dataset.title);
      if (r && r.ok) toast(off ? "칭호를 뗐습니다" : `${window.ptbTitle(b.dataset.title)} — 이름 앞에 달았습니다`);
      else done(r);
      return;
    }
    if (b.dataset.mon) {
      const cur = last.room.mons;
      const next = cur.includes(b.dataset.mon) ? cur.filter((x) => x !== b.dataset.mon) : [...cur, b.dataset.mon];
      return done(await window.ptb.roomSet({ mons: next }));
    }
  });

  window.ptb.onStats(renderMine);
})();
