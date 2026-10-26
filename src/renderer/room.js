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

  function drawDexFrame(g) {
    box(g, 100, 24, 32, 26, "#e2b93b", "#8a6a12", "#ffe28a", "#b8901e");
    R(g, 103, 27, 26, 20, "#fffaf0");
    oval(g, 116, 33, 4, 4, "#e53935", -4, -1); oval(g, 116, 33, 4, 4, "#fafafa", 0, 4);
    R(g, 112, 33, 9, 1, "#222"); R(g, 115, 32, 3, 3, "#222"); R(g, 116, 33, 1, 1, "#fff");
  }

  // 1·10·30·100승마다 배지가 하나씩 빛난다
  const BADGE_AT = [1, 10, 30, 100];
  function drawBadges(g, wins) {
    box(g, 138, 28, 46, 22, "#2b1d19", "#1a110e", "#4e342e");
    const lit = BADGE_AT.filter((n) => wins >= n).length;
    const cols = [["#b0bec5", "#eceff1"], ["#ffca28", "#fff3c4"], ["#4fc3f7", "#d6f2ff"], ["#ef5350", "#ffcdd2"]];
    cols.forEach(([c, hi], i) => {
      const bx = 142 + i * 10, by = 33;
      if (i < lit) { oval(g, bx + 3, by + 4, 3, 4, c); R(g, bx + 2, by + 2, 1, 2, hi); }
      else oval(g, bx + 3, by + 4, 3, 4, "#3a2a24");
    });
  }

  /** 길드 주간 1위 메달 액자 — 몇 번 했는지는 글자로 얹는다 */
  function drawMedal(g) {
    box(g, 100, 56, 32, 30, "#2a3a7a", "#3e2723", "#6d4c41", "#4e342e");
    R(g, 103, 59, 26, 24, "#2f3f86"); dither(g, 103, 59, 26, 24, "#26357a");
    R(g, 110, 60, 4, 9, "#e53935"); R(g, 118, 60, 4, 9, "#1e88e5"); // 리본
    R(g, 112, 66, 8, 3, "#c62828");
    oval(g, 116, 73, 6, 6, "#c49000"); oval(g, 116, 73, 5, 5, "#ffd54f"); oval(g, 116, 73, 2, 2, "#fff3b0");
    R(g, 114, 72, 4, 1, "#c49000");
  }

  function drawPoster(g) {
    const x = 196, y = 18, w = 26, h = 36;
    R(g, x, y, w, h, "#fff3e0"); R(g, x, y + h - 1, w, 1, "#d7c4a8");
    R(g, x + 2, y + 2, w - 4, 20, "#8fd3ff");
    for (let i = 0; i < 12; i++) R(g, x + 4 + i, y + 21 - i, 1, i + 1, i < 4 ? "#ffffff" : "#5b8a6b"); // 왼쪽 산
    for (let i = 0; i < 9; i++) R(g, x + 22 - i, y + 21 - i, 1, i + 1, "#4a7a5b"); // 오른쪽 산
    oval(g, x + 19, y + 7, 2, 2, "#ffd54f");
    R(g, x + 4, y + 26, w - 8, 2, "#8d6e63"); R(g, x + 6, y + 30, w - 12, 1, "#bcaaa4");
    R(g, x - 1, y - 1, 5, 3, "#fff59d88"); R(g, x + w - 4, y - 1, 5, 3, "#fff59d88"); // 테이프
  }

  function drawTrophies(g, count) {
    R(g, 232, 58, 76, 4, "#6d4c41"); R(g, 232, 58, 76, 1, "#8d6e63"); R(g, 240, 62, 3, 4, "#4e342e"); R(g, 296, 62, 3, 4, "#4e342e");
    const n = Math.min(3, count);
    for (let i = 0; i < n; i++) {
      const x = 236 + i * 14, s = i === 0 ? 0 : 2; // 첫 트로피가 가장 크다
      R(g, x + s, 38 + s, 10 - s * 2, 8 - s, "#ffd54f"); R(g, x + s, 38 + s, 10 - s * 2, 1, "#fff3b0");
      R(g, x - 2 + s, 39 + s, 2, 3, "#c49000"); R(g, x + 10 - s, 39 + s, 2, 3, "#c49000");
      R(g, x + 4, 46, 2, 6, "#c49000"); R(g, x + 1, 52, 8, 6, "#8d6e63"); R(g, x + 1, 52, 8, 1, "#a1887f");
    }
    box(g, 280, 34, 24, 24, "#eceff1", "#78909c", "#ffffff"); // 상장
    R(g, 284, 38, 16, 1, "#b0bec5");
  }

  function drawRug(g) {
    oval(g, 160, 168, 66, 14, "#8e1f1f");
    oval(g, 160, 168, 63, 12, "#d64545");
    oval(g, 160, 168, 50, 9, "#c43a3a");
    for (let i = 0; i < 360; i += 18) {
      const a = (i * Math.PI) / 180;
      R(g, Math.round(160 + Math.cos(a) * 56), Math.round(168 + Math.sin(a) * 10.5), 3, 1, "#ffcdd2");
    }
    oval(g, 160, 168, 20, 4, "#e05a5a");
  }

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
      if (st) g.drawImage(st, 20 - Math.floor(st.width / 2), 43 - st.height);
      else { box(g, 12, 18, 16, 25, "#8a8a8a", "#5f5f5f", "#a0a0a0", "#767676"); R(g, 15, 24, 4, 3, "#767676"); }
    } },
  };
  const COIN_ORDER = ["statue", "fireplace", "healer", "arcade", "jukebox", "masterball", "beanbag", "pond", "clock", "neon"];

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
  function toStone(img, maxH) {
    const W0 = img.naturalWidth, H0 = img.naturalHeight;
    const [, g] = canvas(W0, H0);
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, W0, H0).data;
    let x0 = W0, y0 = H0, x1 = 0, y1 = 0;
    for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) if (d[(y * W0 + x) * 4 + 3] > 40) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (x1 < x0) return null;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, s = Math.min(1, maxH / bh, 38 / bw);
    const [o, og] = canvas(Math.max(1, Math.round(bw * s)), Math.max(1, Math.round(bh * s)));
    const P = ["#585858", "#767676", "#999999", "#c2c2c2"];
    for (let y = 0; y < o.height; y++) for (let x = 0; x < o.width; x++) {
      const i = ((y0 + Math.floor(y / s)) * W0 + x0 + Math.floor(x / s)) * 4;
      if (d[i + 3] <= 40) continue;
      const lum = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
      R(og, x, y, 1, 1, P[Math.min(3, Math.floor(lum * 4.2))]);
    }
    return o;
  }

  /** 코인 가구를 놓을 자리 — 이미 놓인 사탕 가구 · 벽 장식과 겹치지 않는 후보부터. → { id: [x, y, w, h] } */
  function placeCoin(on, d, posOf) {
    const area = (a, b) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
    const wall = [[100, 24, 32, 26]]; // 도감 액자는 늘 있다
    if (on.has("window")) wall.push([20, 19, 76, 63]);
    if (d.wins > 0) wall.push([138, 28, 46, 22]);
    if (on.has("poster")) wall.push([195, 17, 28, 38]);
    if (d.graduated > 0) wall.push([232, 34, 76, 32]);
    if (d.weekTop > 0) wall.push([100, 56, 32, 40]); // 아래 "주간 1위" 글자까지
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
    const key = JSON.stringify([d.kind, d.code, d.guildName, d.count, d.notice, d.weekTop, d.theme, d.furni, d.statue, d.pos, d.dex && d.dex.seen, d.dex && d.dex.total, d.wins, d.graduated, d.lastGrad, d.trainer, period(d.theme)]);
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

  function banner(g, x, col) {
    const [c, hi, dk] = col;
    R(g, x - 3, 12, 32, 3, "#c9a227"); R(g, x - 3, 12, 32, 1, "#ffe28a"); // 봉
    for (let y = 15; y < 72; y++) {
      const inset = y > 62 ? (y - 62) : 0; // 아래가 뾰족하다
      R(g, x + inset, y, 26 - inset * 2, 1, y % 2 ? c : c);
      R(g, x + inset, y, 1, 1, dk); R(g, x + 25 - inset, y, 1, 1, dk);
    }
    R(g, x + 2, 17, 22, 1, hi);
    // 문장 — 방패에 별
    for (let i = 0; i < 16; i++) { const w = i < 10 ? 14 : 14 - (i - 9) * 2; R(g, x + 13 - (w >> 1), 26 + i, w, 1, i === 0 ? "#fff" : "#f5f5f5"); }
    for (let i = 0; i < 7; i++) R(g, x + 13 - Math.floor(i / 2), 29 + i, 1 + Math.floor(i / 2) * 2, 1, c);
    R(g, x + 9, 32, 9, 1, c);
  }

  function torch(g, x, night) {
    // 둘레 빛
    const a = night ? 0.28 : 0.12;
    for (let r = 26; r > 4; r -= 6) { g.fillStyle = `rgba(255, 170, 60, ${a / 3})`; g.beginPath(); g.ellipse(x + 2, 40, r, r * 0.9, 0, 0, Math.PI * 2); g.fill(); }
    R(g, x, 44, 5, 12, "#5d4037"); R(g, x - 2, 44, 9, 2, "#3e2723"); R(g, x - 1, 54, 7, 2, "#3e2723");
    oval(g, x + 2, 39, 4, 6, "#ff7043"); oval(g, x + 2, 40, 3, 4, "#ffb74d"); oval(g, x + 2, 41, 1, 2, "#fff3c4");
  }

  function sign(g) {
    box(g, 108, 16, 104, 28, "#8d5a34", "#4e3018", "#a8743f", "#6b4424");
    R(g, 111, 19, 98, 22, "#7a4e2a");
    R(g, 108, 16, 104, 2, "#c9a227"); R(g, 108, 42, 104, 2, "#c9a227");
    for (const x of [111, 207]) { R(g, x, 13, 2, 4, "#6d6d6d"); }
  }

  function noticeBoard(g) {
    box(g, 226, 62, 40, 32, "#c8a46e", "#6b4424", "#dcbc88", "#a8834f"); // 코르크
    const notes = [[230, 66, "#fff9c4"], [245, 64, "#ffffff"], [233, 79, "#e1f5fe"], [251, 77, "#fce4ec"]];
    for (const [x, y, c] of notes) { R(g, x, y, 12, 11, c); R(g, x + 2, y + 3, 8, 1, "#9e9e9e"); R(g, x + 2, y + 6, 6, 1, "#bdbdbd"); R(g, x + 5, y - 1, 2, 2, "#e53935"); }
  }

  const HALL = {
    fountain: { x: 126, y: 120, w: 68, h: 48, draw(g) {
      oval(g, 34, 38, 33, 9, "#5f5a52"); // 바닥 그늘
      oval(g, 34, 35, 32, 9, "#a39a8e"); oval(g, 34, 35, 30, 7, "#8f877c"); // 테두리 돌
      oval(g, 34, 34, 27, 6, "#4fa3d9"); oval(g, 34, 33, 22, 4, "#6ec3f4"); // 물
      for (let i = 0; i < 6; i++) R(g, 16 + i * 7, 32 + (i % 2), 3, 1, "#cfefff");
      R(g, 30, 14, 8, 20, "#9a9186"); R(g, 30, 14, 2, 20, "#b2a99c"); // 기둥
      oval(g, 34, 14, 12, 3, "#a39a8e"); oval(g, 34, 13, 10, 2, "#6ec3f4"); // 위 그릇
      for (const [x, y] of [[24, 16], [22, 20], [21, 25], [44, 16], [46, 20], [47, 25]]) R(g, x, y, 1, 3, "#bfeaff"); // 물줄기
      R(g, 33, 4, 2, 9, "#bfeaff"); R(g, 32, 3, 4, 2, "#e3f6ff");
    } },
    treeL: { x: 6, y: 138, w: 26, h: 54, draw: (g) => pottedTree(g) },
    treeR: { x: 288, y: 138, w: 26, h: 54, draw: (g) => pottedTree(g) },
  };
  function pottedTree(g) {
    box(g, 5, 40, 16, 14, "#8d5a34", "#4e3018", "#a8743f", "#6b4424");
    R(g, 12, 26, 2, 15, "#5d4037");
    oval(g, 13, 16, 12, 12, "#2e6b3a"); oval(g, 11, 14, 9, 9, "#3f8a4a"); oval(g, 9, 11, 4, 4, "#5aa864");
  }

  function paintHall(Rm, d) {
    const per = period("hall");
    const night = per === "night";
    const col = guildColor(d.code);
    const [base, g] = canvas(AW, AH);
    hallWall(g);
    R(g, 0, FLOOR - 6, AW, 6, "#5f574e"); R(g, 0, FLOOR - 6, AW, 1, "#7a7268"); R(g, 0, FLOOR - 1, AW, 1, "#4a433b");
    hallFloor(g);
    dither(g, 0, FLOOR, AW, 3, "#0000002e");
    // 길 — 입구에서 분수까지 깐 길드 색 융단
    for (let y = FLOOR; y < AH; y++) { const w = 24 + Math.round((y - FLOOR) * 0.5); R(g, 160 - w, y, w * 2, 1, (y - FLOOR) % 6 ? col[0] : col[2]); }
    for (let y = FLOOR; y < AH; y++) { const w = 24 + Math.round((y - FLOOR) * 0.5); R(g, 160 - w, y, 2, 1, "#c9a227"); R(g, 160 + w - 2, y, 2, 1, "#c9a227"); }
    banner(g, 30, col); banner(g, 264, col);
    sign(g);
    noticeBoard(g);
    torch(g, 84, night); torch(g, 232, night);
    if (per !== "day") { g.fillStyle = night ? "rgba(10, 14, 40, .3)" : "rgba(60, 20, 40, .1)"; g.fillRect(0, 0, AW, AH); }

    const html = [];
    for (const [id, f] of Object.entries(HALL)) {
      html.push(`<canvas class="rm-f" data-h="${id}" width="${f.w}" height="${f.h}" style="left:${X(f.x)}%; top:${Y(f.y)}%; width:${X(f.w)}%; height:${Y(f.h)}%; z-index:${(f.y + f.h) * 10};"></canvas>`);
    }
    html.push(`<i class="rm-spark" style="left:${X(158)}%; top:${Y(122)}%; z-index:1700"></i><i class="rm-spark b" style="left:${X(168)}%; top:${Y(130)}%; right:auto; z-index:1700"></i>`);
    html.push(`<span class="rm-txt sign" style="left:${X(160)}%; top:${Y(30)}%;">${esc(d.guildName || "길드")}</span>`);
    html.push(`<span class="rm-txt lt" style="left:${X(246)}%; top:${Y(99)}%;">${d.notice ? esc(d.notice) : "길드 게시판"}</span>`);
    html.push(`<div class="rm-plate"><b>${esc(d.guildName || "길드")}</b> 길드 홀<br>길드원 ${d.count || 0}명</div>`);

    Rm.el.dataset.theme = "hall";
    Rm.el.dataset.per = per;
    const layer = Rm.el.querySelector(".rm-scene");
    layer.innerHTML = "";
    base.className = "rm-base";
    layer.appendChild(base);
    layer.insertAdjacentHTML("beforeend", html.join(""));
    for (const c of layer.querySelectorAll("canvas.rm-f")) {
      const g2 = c.getContext("2d");
      g2.imageSmoothingEnabled = false;
      HALL[c.dataset.h].draw(g2);
    }
    Rm.coin = [];
    Rm.scene = { on: new Set(["fountain"]), per, theme: "hall", hall: true };
  }

  function paintScene(Rm, d) {
    const on = new Set((d.furni || []).filter((id) => FURN[id] || COIN[id] || ["window", "rug", "poster"].includes(id)));
    const theme = THEMES[d.theme] ? d.theme : "cabin";
    const per = period(theme);
    const T = THEMES[theme];
    const dex = d.dex || { seen: 0, total: 0 };
    const posOf = (id, f) => (d.pos && d.pos[id]) || [f.x, f.y]; // 끌어 옮긴 자리 — 없으면 정해 둔 자리

    const [base, g] = canvas(AW, AH);
    T.wall(g);
    trim(g, T);
    T.floor(g);
    dither(g, 0, FLOOR, AW, 3, "#0000002e"); // 벽 아래 그늘
    if (on.has("window")) drawWindow(g, theme, per);
    drawDexFrame(g);
    if (d.wins > 0) drawBadges(g, d.wins);
    if (on.has("poster")) drawPoster(g);
    if (d.graduated > 0) drawTrophies(g, d.graduated);
    if (d.weekTop > 0) drawMedal(g);
    if (on.has("rug")) drawRug(g);
    // 밤이면 방이 어두워지고 램프 둘레만 밝다
    if (per === "night" || per === "evening") {
      g.fillStyle = per === "night" ? "rgba(10, 14, 40, .32)" : "rgba(60, 20, 40, .12)";
      g.fillRect(0, 0, AW, AH);
    }
    if (on.has("lamp")) {
      const a = per === "night" ? 0.3 : 0.14;
      const [lx, ly] = posOf("lamp", FURN.lamp);
      for (let r = 34; r > 4; r -= 6) { g.fillStyle = `rgba(255, 220, 140, ${a / 3})`; g.beginPath(); g.ellipse(lx + 9, ly + 10, r, r * 0.85, 0, 0, Math.PI * 2); g.fill(); }
    }

    const html = [];
    for (const id of ["lamp", "bed", "aquarium", "tv", "desk", "shelf", "plant", "cushion"]) {
      if (!on.has(id)) continue;
      const f = FURN[id];
      const [x, y] = posOf(id, f);
      html.push(`<canvas class="rm-f" data-f="${id}" data-move="floor" data-x="${x}" data-y="${y}" width="${f.w}" height="${f.h}" style="left:${X(x)}%; top:${Y(y)}%; width:${X(f.w)}%; height:${Y(f.h)}%; z-index:${(y + f.h) * 10};"></canvas>`);
    }
    const pl = placeCoin(on, d, posOf);
    for (const [id, [x, y, w, h]] of Object.entries(pl)) {
      const z = COIN[id].wall ? 5 : COIN[id].flat ? 2 : (y + h) * 10;
      const move = COIN[id].wall ? "wall" : COIN[id].flat ? "flat" : "floor";
      html.push(`<canvas class="rm-f" data-c="${id}" data-move="${move}" data-x="${x}" data-y="${y}" width="${w}" height="${h}" style="left:${X(x)}%; top:${Y(y)}%; width:${X(w)}%; height:${Y(h)}%; z-index:${z};"></canvas>`);
    }
    if (on.has("aquarium")) {
      // 물고기는 움직여야 해서 따로 얹는다
      const [ax, ay] = posOf("aquarium", FURN.aquarium);
      html.push(`<i class="rm-fish" style="left:${X(ax + 4)}%; top:${Y(ay + 8)}%; --sw:${X(26)}cqw;"></i><i class="rm-fish b" style="left:${X(ax + 6)}%; top:${Y(ay + 15)}%; --sw:${X(22)}cqw;"></i>`);
    }
    // 글자 — 캔버스에 쓰면 뭉개진다
    html.push(`<span class="rm-txt" style="left:${X(116)}%; top:${Y(41)}%;">${dex.seen}/${dex.total}</span>`);
    if (d.wins > 0) html.push(`<span class="rm-txt lt" style="left:${X(161)}%; top:${Y(52)}%;">${d.wins}승</span>`);
    if (d.graduated > 0) html.push(`<span class="rm-txt sm" style="left:${X(292)}%; top:${Y(44)}%;">졸업<br>${esc(d.lastGrad || "")}</span>`);
    if (d.weekTop > 0) html.push(`<span class="rm-txt lt" style="left:${X(116)}%; top:${Y(90)}%;">주간 1위 ×${d.weekTop}</span>`);
    html.push(`<div class="rm-plate"><b>${esc(d.trainer || "나")}</b>의 방<br>도감 ${dex.seen} · 졸업 ${d.graduated || 0}</div>`);

    Rm.el.dataset.theme = theme;
    Rm.el.dataset.per = per; // 밤이면 가구·아이들도 같이 어두워진다(room.css)
    const layer = Rm.el.querySelector(".rm-scene");
    layer.innerHTML = "";
    base.className = "rm-base";
    layer.appendChild(base);
    layer.insertAdjacentHTML("beforeend", html.join(""));
    Rm.coin = [];
    for (const c of layer.querySelectorAll("canvas.rm-f")) {
      const g2 = c.getContext("2d");
      g2.imageSmoothingEnabled = false;
      if (c.dataset.f) FURN[c.dataset.f].draw(g2);
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
  window.ptbRoom = { create, FURN_IDS: [...Object.keys(FURN), ...Object.keys(COIN)] };

  /* ================= 내 방 ================= */

  const mine = create($("rmRoom"));
  mine.setEmpty("아래에서 방에 둘 포켓몬을 골라 주세요");
  const BADGE_NOTE = [1, 10, 30, 100];

  function renderPanel(s) {
    const R0 = s.room;
    const left = s.candy ? s.candy.left : 0;
    $("rmWallet").textContent = "🍬 " + left;
    $("rmTags").classList.toggle("on", Boolean(R0.tags));
    document.body.classList.toggle("rm-tags-on", Boolean(R0.tags)); // 길드원 방을 볼 때도
    $("rmReset").disabled = !Object.keys(R0.pos || {}).length;

    // 코인 꾸미기는 산 것만 위 목록에 섞이고, 안 산 것은 아래 코인 칸에 따로 보인다
    $("rmThemes").innerHTML = R0.themes
      .filter((t) => !t.coin || t.owned)
      .map((t) => t.owned
        ? `<button data-theme="${t.id}" class="${t.id === R0.theme ? "on" : ""}">${t.icon} ${t.name}</button>`
        : `<button data-buy-theme="${t.id}" ${left < t.cost ? "disabled" : ""}>${t.icon} ${t.name}<span class="c">🍬${t.cost}</span></button>`)
      .join("");

    $("rmFurni").innerHTML = R0.furni
      .filter((f) => !f.coin || f.owned)
      .map((f) => `<div class="it${f.coin ? " coin" : ""}"><span class="ic">${f.icon}</span><span class="t">${f.name}<span>${f.desc}</span></span>${
        f.owned
          ? `<button data-toggle="${f.id}">${f.on ? "치우기" : "놓기"}</button>`
          : `<button class="buy" data-buy-furni="${f.id}" ${left < f.cost ? "disabled" : ""}>🍬${f.cost}</button>`
      }</div>`)
      .join("");

    renderCoins(R0);

    const dex = s.dex || { seen: 0, total: 0 };
    const next = BADGE_NOTE.find((n) => R0.wins < n);
    $("rmRec").innerHTML = [
      `🖼️ <b>도감 액자</b> — 도감 ${dex.seen}/${dex.total}. 만날수록 숫자가 오른다`,
      `🏅 <b>결투 배지 진열장</b> — ${R0.wins}승${next ? ` · ${next}승이면 배지가 하나 더 빛난다` : " · 배지를 다 모았다"}`,
      `🏆 <b>졸업 트로피</b> — ${R0.graduated ? `${R0.graduated}마리 졸업 (마지막: ${esc(R0.lastGrad)})` : "마스터까지 키우면 생긴다"}`,
      `🏅 <b>주간 1위 메달</b> — ${R0.weekTop ? `${R0.weekTop}번` : "길드에서 한 주 동안 토큰을 가장 많이 쓰면 생긴다"}`,
    ].join("<br>");

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
      trainer: (s.friend && s.friend.trainer) || "나",
    };
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
    const c = e.target.closest("canvas.rm-f[data-move]");
    if (!c) return;
    e.preventDefault();
    c.setPointerCapture(e.pointerId);
    drag = { c, id: c.dataset.f || c.dataset.c, move: c.dataset.move, sx: e.clientX, sy: e.clientY, x0: Number(c.dataset.x), y0: Number(c.dataset.y), w: c.width, h: c.height, k: AW / roomEl.getBoundingClientRect().width, at: null };
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
    if (b.dataset.mon) {
      const cur = last.room.mons;
      const next = cur.includes(b.dataset.mon) ? cur.filter((x) => x !== b.dataset.mon) : [...cur, b.dataset.mon];
      return done(await window.ptb.roomSet({ mons: next }));
    }
  });

  window.ptb.onStats(renderMine);
})();
