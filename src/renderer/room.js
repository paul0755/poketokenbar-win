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
 * 방 탭이 안 보이는 동안은 멈춘다.
 *
 * 30초마다 갱신이 오지만 방 그림은 바뀐 게 있을 때만 다시 칠하고, 걷던 아이들은 그대로 둔다.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const AW = 320; // 그림 좌표(픽셀)
  const AH = 200;
  const FLOOR = 124; // 벽과 바닥의 경계
  let last = null;
  let sceneKey = "";
  let scene = null; // 지금 그린 방 — 가구 자리(행동이 쓴다)

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
  };

  /* ================= 방 그리기 ================= */

  const SIZE = { baby: 10.5, mid: 12.5, final: 15, master: 15 }; // 방 너비의 %
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function paintScene(s) {
    const R0 = s.room;
    const on = new Set(R0.furni.filter((f) => f.on).map((f) => f.id));
    const theme = THEMES[R0.theme] ? R0.theme : "cabin";
    const per = period(theme);
    const T = THEMES[theme];
    const dex = s.dex || { seen: 0, total: 0 };

    const [base, g] = canvas(AW, AH);
    T.wall(g);
    R(g, 0, FLOOR - 6, AW, 6, T.trim[0]); R(g, 0, FLOOR - 6, AW, 1, T.trim[2]); R(g, 0, FLOOR - 1, AW, 1, T.trim[1]);
    T.floor(g);
    dither(g, 0, FLOOR, AW, 3, "#0000002e"); // 벽 아래 그늘
    if (on.has("window")) drawWindow(g, theme, per);
    drawDexFrame(g);
    if (R0.wins > 0) drawBadges(g, R0.wins);
    if (on.has("poster")) drawPoster(g);
    if (R0.graduated > 0) drawTrophies(g, R0.graduated);
    if (on.has("rug")) drawRug(g);
    // 밤이면 방이 어두워지고 램프 둘레만 밝다
    if (per === "night" || per === "evening") {
      g.fillStyle = per === "night" ? "rgba(10, 14, 40, .32)" : "rgba(60, 20, 40, .12)";
      g.fillRect(0, 0, AW, AH);
    }
    if (on.has("lamp")) {
      const a = per === "night" ? 0.3 : 0.14;
      for (let r = 34; r > 4; r -= 6) { g.fillStyle = `rgba(255, 220, 140, ${a / 3})`; g.beginPath(); g.ellipse(15, 80, r, r * 0.85, 0, 0, Math.PI * 2); g.fill(); }
    }

    const html = [];
    for (const id of ["lamp", "bed", "aquarium", "tv", "desk", "shelf", "plant", "cushion"]) {
      if (!on.has(id)) continue;
      const f = FURN[id];
      html.push(`<canvas class="rm-f" data-f="${id}" width="${f.w}" height="${f.h}" style="left:${X(f.x)}%; top:${Y(f.y)}%; width:${X(f.w)}%; height:${Y(f.h)}%; z-index:${(f.y + f.h) * 10};"></canvas>`);
    }
    if (on.has("aquarium")) {
      // 물고기는 움직여야 해서 따로 얹는다
      html.push(`<i class="rm-fish" style="left:${X(108)}%; top:${Y(104)}%; --sw:${X(26)}cqw;"></i><i class="rm-fish b" style="left:${X(110)}%; top:${Y(111)}%; --sw:${X(22)}cqw;"></i>`);
    }
    // 글자 — 캔버스에 쓰면 뭉개진다
    html.push(`<span class="rm-txt" style="left:${X(116)}%; top:${Y(41)}%;">${dex.seen}/${dex.total}</span>`);
    if (R0.wins > 0) html.push(`<span class="rm-txt lt" style="left:${X(161)}%; top:${Y(52)}%;">${R0.wins}승</span>`);
    if (R0.graduated > 0) html.push(`<span class="rm-txt sm" style="left:${X(292)}%; top:${Y(44)}%;">졸업<br>${esc(R0.lastGrad || "")}</span>`);
    html.push(`<div class="rm-plate"><b>${esc((s.friend && s.friend.trainer) || "나")}</b>의 방<br>도감 ${dex.seen} · 졸업 ${R0.graduated}</div>`);

    const room = $("rmRoom");
    room.dataset.theme = theme;
    room.dataset.per = per; // 밤이면 가구·아이들도 같이 어두워진다(room.css)
    const layer = room.querySelector(".rm-scene");
    layer.innerHTML = "";
    base.className = "rm-base";
    layer.appendChild(base);
    layer.insertAdjacentHTML("beforeend", html.join(""));
    for (const c of layer.querySelectorAll("canvas.rm-f")) {
      const g2 = c.getContext("2d");
      g2.imageSmoothingEnabled = false;
      FURN[c.dataset.f].draw(g2);
    }
    scene = { on, per, theme };
  }

  /* ================= 포켓몬 ================= */

  const actors = new Map(); // id → 상태
  const rand = (a, b) => a + Math.random() * (b - a);
  const nightish = () => scene && scene.per === "night";

  function hPct(a) { return a.h * 1.6; } // 방은 16:10 — 너비 1% 는 높이 1.6%

  function place(a) {
    a.el.style.left = a.x + "%";
    // GIF 아래쪽에 빈칸이 있어서 발이 닿도록 조금 내린다
    a.el.style.top = a.y - hPct(a) * 0.92 + "%";
    a.el.style.zIndex = a.z != null ? a.z : Math.round(Y(0) + a.y * 2 * 10);
    a.body.classList.toggle("r", a.face < 0);
  }

  function say(a, text, ms = 1800, cls = "") {
    a.bub.textContent = text;
    a.bub.className = "rm-bub on " + cls;
    clearTimeout(a.bubT);
    if (ms) a.bubT = setTimeout(() => (a.bub.className = "rm-bub"), ms);
  }

  function makeActor(m) {
    const el = document.createElement("div");
    el.className = "rm-mon";
    el.innerHTML = `<div class="rm-body"><img alt=""><div class="rm-shadow"></div></div><div class="rm-bub"></div><div class="rm-tag"></div>`;
    const a = {
      id: m.id, el, body: el.querySelector(".rm-body"), img: el.querySelector("img"), bub: el.querySelector(".rm-bub"), tag: el.querySelector(".rm-tag"),
      x: rand(WALK.x0, WALK.x1), y: rand(WALK.y0, WALK.y1), tx: 0, ty: 0, face: Math.random() < 0.5 ? 1 : -1,
      state: "idle", t: rand(0.3, 2), goal: null, cool: rand(4, 10), z: null, h: 12, small: false,
    };
    el.addEventListener("click", () => poke(a));
    $("rmActors").appendChild(el);
    return a;
  }

  function dress(a, m) {
    a.h = SIZE[m.stageKey] || 12;
    a.small = m.stageKey === "baby" || m.stageKey === "mid";
    a.el.style.setProperty("--h", a.h);
    const src = m.animUrl || m.url || "";
    if (a.img.getAttribute("src") !== src) a.img.src = src;
    const lv = m.profile ? ` · Lv.${m.profile.level}` : "";
    a.tag.textContent = `${m.name}${m.shiny ? " ★" : ""}${lv}${m.active ? " · 키우는 중" : ""}`;
    a.el.classList.toggle("shiny", Boolean(m.shiny));
    if (m.shiny && !a.el.querySelector(".rm-spark")) a.el.insertAdjacentHTML("beforeend", '<i class="rm-spark"></i><i class="rm-spark b"></i>');
    place(a);
  }

  function syncActors(s) {
    const want = s.room.mons.map((id) => (s.box || []).find((m) => m.id === id)).filter(Boolean);
    const keep = new Set(want.map((m) => m.id));
    for (const [id, a] of actors) if (!keep.has(id)) { a.el.remove(); actors.delete(id); }
    for (const m of want) {
      const a = actors.get(m.id) || makeActor(m);
      actors.set(m.id, a);
      dress(a, m);
    }
    $("rmEmpty").hidden = want.length > 0;
  }

  /** 자리가 사라졌으면(가구를 치웠으면) 하던 일을 그만둔다 */
  function release() {
    for (const a of actors.values()) {
      if (["sit", "sleep", "eat", "watch"].includes(a.state) || a.goal) { a.state = "idle"; a.goal = null; a.z = null; a.t = rand(0.2, 1); a.el.classList.remove("sit", "sleep"); }
    }
  }

  const busyAt = (spot) => [...actors.values()].some((a) => a.goal === spot || a.at === spot);

  function walkTo(a, x, y, goal = null) {
    a.tx = x; a.ty = y; a.goal = goal; a.state = "walk"; a.at = null;
    a.el.classList.remove("sit", "sleep");
    a.z = null;
  }

  /** 다음에 무엇을 할까 */
  function decide(a) {
    const on = scene ? scene.on : new Set();
    const opts = [["walk", 5], ["idle", 1.5]];
    if (on.has("plant") && !busyAt("plant")) opts.push(["plant", 1.2]);
    if (on.has("cushion") && a.small && !busyAt("cushion")) opts.push(["cushion", 1.3]);
    if (on.has("tv") && !busyAt("tv")) opts.push(["tv", 1]);
    opts.push(["sleep", nightish() ? 3.5 : 0.25]);
    let r = Math.random() * opts.reduce((n, o) => n + o[1], 0);
    const pick = opts.find((o) => (r -= o[1]) <= 0)[0];

    if (pick === "walk") walkTo(a, rand(WALK.x0, WALK.x1), rand(WALK.y0, WALK.y1));
    else if (pick === "idle") { a.state = "idle"; a.t = rand(1.5, 4); }
    else if (pick === "sleep") {
      if (on.has("bed") && !busyAt("bed")) walkTo(a, SPOT.bed.x - 3, WALK.y0 + 1, "bed");
      else { a.state = "sleep"; a.t = rand(6, 12); a.el.classList.add("sleep"); say(a, "Z z", 0, "z"); }
    } else walkTo(a, SPOT[pick].x + rand(-1.5, 1.5), SPOT[pick].y, pick);
  }

  function arrive(a) {
    const goal = a.goal;
    a.goal = null;
    if (!goal) { a.state = "idle"; a.t = rand(1, 3.5); return; }
    a.at = goal;
    if (goal === "plant") { a.state = "eat"; a.t = rand(3, 5); a.face = SPOT.plant.face; say(a, "냠냠", 2600); }
    else if (goal === "cushion") { a.state = "sit"; a.t = rand(6, 12); a.x = SPOT.cushion.x; a.y = SPOT.cushion.y; a.z = 1910; a.el.classList.add("sit"); }
    else if (goal === "tv") { a.state = "watch"; a.t = rand(5, 9); a.face = 1; say(a, "♪", 2000); }
    else if (goal === "bed") {
      a.state = "sleep"; a.t = nightish() ? rand(14, 26) : rand(6, 10);
      a.x = SPOT.bed.x; a.y = SPOT.bed.y; a.z = 1345; a.face = 1;
      a.el.classList.add("sleep"); say(a, "Z z", 0, "z");
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
        a.z = null;
        if (wasAt === "bed") { a.y = WALK.y0 + 1; }
        decide(a);
      }
    }
    a.cool -= dt;
    place(a);
  }

  /** 가까이 마주치면 서로 본다 — 하트나 음표 */
  function meet() {
    const list = [...actors.values()].filter((a) => (a.state === "walk" || a.state === "idle") && a.cool <= 0);
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
    if ($("tab-room").hidden || !actors.size) return; // 안 보이면 쉰다
    for (const a of actors.values()) step(a, dt);
    meet();
  }
  requestAnimationFrame(tick);

  /* ================= 꾸미기 패널 ================= */

  function renderPanel(s) {
    const R0 = s.room;
    const left = s.candy ? s.candy.left : 0;
    $("rmWallet").textContent = "🍬 " + left;

    $("rmThemes").innerHTML = R0.themes
      .map((t) => t.owned
        ? `<button data-theme="${t.id}" class="${t.id === R0.theme ? "on" : ""}">${t.icon} ${t.name}</button>`
        : `<button data-buy-theme="${t.id}" ${left < t.cost ? "disabled" : ""}>${t.icon} ${t.name}<span class="c">🍬${t.cost}</span></button>`)
      .join("");

    $("rmFurni").innerHTML = R0.furni
      .map((f) => `<div class="it"><span class="ic">${f.icon}</span><span class="t">${f.name}<span>${f.desc}</span></span>${
        f.owned
          ? `<button data-toggle="${f.id}">${f.on ? "치우기" : "놓기"}</button>`
          : `<button class="buy" data-buy-furni="${f.id}" ${left < f.cost ? "disabled" : ""}>🍬${f.cost}</button>`
      }</div>`)
      .join("");

    const dex = s.dex || { seen: 0, total: 0 };
    const next = BADGE_AT.find((n) => R0.wins < n);
    $("rmRec").innerHTML = [
      `🖼️ <b>도감 액자</b> — 도감 ${dex.seen}/${dex.total}. 만날수록 숫자가 오른다`,
      `🏅 <b>결투 배지 진열장</b> — ${R0.wins}승${next ? ` · ${next}승이면 배지가 하나 더 빛난다` : " · 배지를 다 모았다"}`,
      `🏆 <b>졸업 트로피</b> — ${R0.graduated ? `${R0.graduated}마리 졸업 (마지막: ${esc(R0.lastGrad)})` : "마스터까지 키우면 생긴다"}`,
    ].join("<br>");

    const pickable = (s.box || []).filter((m) => m.stageKey !== "egg");
    const inRoom = new Set(R0.mons);
    $("rmMonsCount").textContent = `${R0.mons.length}/${R0.max}`;
    $("rmMons").innerHTML = pickable
      .map((m) => `<button data-mon="${m.id}" class="${inRoom.has(m.id) ? "on" : ""}" ${!inRoom.has(m.id) && R0.mons.length >= R0.max ? "disabled" : ""}>${m.url ? `<img src="${esc(m.url)}" alt="">` : ""}${esc(m.name)}</button>`)
      .join("") || '<span class="rm-rec">알만 있습니다. 부화하면 방에 둘 수 있습니다.</span>';
  }

  /* ================= 연결 ================= */

  function render(s) {
    if (!s || !s.room) return;
    last = s;
    const R0 = s.room;
    const dex = s.dex || { seen: 0 };
    const key = JSON.stringify([R0.theme, R0.furni.filter((f) => f.on).map((f) => f.id), dex.seen, dex.total, R0.wins, R0.graduated, R0.lastGrad, s.friend && s.friend.trainer, period(R0.theme)]);
    if (key !== sceneKey) {
      sceneKey = key;
      paintScene(s);
      release();
    }
    syncActors(s);
    renderPanel(s);
  }

  // 낮 → 저녁 → 밤이 바뀌면 창밖을 다시 그린다
  setInterval(() => last && render(last), 60_000);

  const done = (r) => {
    if (!r || !r.ok) toast((r && r.reason) || "하지 못했습니다", "bad");
    else if (r.message) toast(r.message);
  };

  $("rmPanel").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled || !last) return;
    if (b.dataset.theme) return done(await window.ptb.roomSet({ theme: b.dataset.theme }));
    if (b.dataset.toggle) return done(await window.ptb.roomSet({ toggle: b.dataset.toggle }));
    if (b.dataset.buyTheme || b.dataset.buyFurni) {
      b.disabled = true; // 연타로 두 번 사지 않게
      return done(await window.ptb.roomBuy(b.dataset.buyTheme ? { kind: "theme", id: b.dataset.buyTheme } : { kind: "furni", id: b.dataset.buyFurni }));
    }
    if (b.dataset.mon) {
      const cur = last.room.mons;
      const next = cur.includes(b.dataset.mon) ? cur.filter((x) => x !== b.dataset.mon) : [...cur, b.dataset.mon];
      return done(await window.ptb.roomSet({ mons: next }));
    }
  });

  window.ptb.onStats(render);
})();
