"use strict";
/**
 * 🦖 디지몬 기술 연출 — 바탕화면 펫이 필살기를 쓰는 장면(디지털 월드).
 *
 * 포켓몬 연출(moves.js)은 별 · 방울 · 잎 · Zzz 처럼 둥글고 귀엽다. 디지몬은 데이터로 된 생물이니
 * 연출도 "화면 속 데이터"로 간다 — 둥근 것은 없고 전부 네모난 픽셀과 직선이다.
 *
 *   몸     글리치 — 색이 갈라지며 덜덜 떨다가, 쏘는 순간 뒤로 튄다
 *   바탕   디지코드 — 등 뒤로 기호 줄기가 솟는다
 *   기술   이름으로 넷 중 하나
 *            beam  쏘는 것(Flame · Cannon · Breath · Force …) — 계단 진 픽셀 광선 + 맞는 자리 폭발
 *            slash 베는 것(Claw · Fist · Kick · Sword …)     — 계단 진 사선 세 줄이 긋고 부서진다
 *            hex   막는 것(Shield · Wall · Guard …)          — 육각형 결계가 펼쳐진다
 *            burst 나머지                                     — 네모 조각이 격자를 따라 튀어 나간다
 *   색     속성 — 백신 하늘 · 데이터 초록 · 바이러스 보라 · 프리 노랑
 *   크기   단계 — 성장기 1 ~ 궁극체 4. 궁극체는 창이 흔들린다
 *   이름   머리 위 터미널 창 "▶ GAIA FORCE" 를 한 글자씩 친다
 *
 * 캔버스는 연출하는 2초 남짓만 그리고 멈춘다(moves.js 와 같은 원칙 — 펫은 하루 종일 떠 있다).
 */
(function () {
  const DURATION = 1900;
  const COLOR = {
    백신: ["#5ee7ff", "#2a8cff", "#d6f9ff"],
    데이터: ["#3dffb4", "#12b886", "#d2ffee"],
    바이러스: ["#b45cff", "#ff3d7a", "#f0d6ff"],
    프리: ["#ffe066", "#ffb703", "#ffffff"],
    언노운: ["#cfd4dc", "#7c8494", "#ffffff"],
  };
  const colorOf = (attr) => COLOR[attr] || COLOR.데이터;

  const KIND = [
    ["beam", /beam|cannon|laser|blast|shot|shoot|breath|flame|fire|ray|force|bomb|buster|wave|thunder|lightning|elec|storm|nova|missile|bullet|impulse|spit|flare|burn|heat|drive|pitch|smash|crash/i],
    ["slash", /claw|fist|punch|kick|slash|blade|sword|cross|edge|spear|heel|knuckle|strike|cutter|horn|fang|bite|rush|tackle|blow|stance|lance|axe|sting|needle|scissor|slice/i],
    ["hex", /shield|wall|guard|barrier|aegis|armor|armour|protect|jail|cage|meditation|devout/i],
  ];
  const kindOf = (name) => (KIND.find(([, re]) => re.test(name)) || ["burst"])[0];

  /* ---------------- 그리기 도구 — 전부 격자에 맞춘다(픽셀 느낌) ---------------- */
  let cv = null, g = null, W = 0, H = 0, P = 2, raf = 0, busy = false;
  const snap = (v) => Math.round(v / P) * P;
  const box = (x, y, s, c, a = 1) => {
    g.globalAlpha = a;
    g.fillStyle = c;
    g.fillRect(snap(x), snap(y), s, s);
  };
  /** 가로세로만 꺾이는 계단 선 */
  function stairs(x0, y0, x1, y1, c, a, thick) {
    const n = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / P));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      for (let k = 0; k < thick; k++) box(x, y + k * P, P, c, a);
    }
  }
  // 디지코드 한 글자 — 3 × 5 칸에 켜진 칸
  const GLY = Array.from({ length: 16 }, (_, i) => {
    let s = (i + 3) * 2654435761 >>> 0;
    const bits = [];
    for (let k = 0; k < 15; k++) { s = (s * 1103515245 + 12345) >>> 0; bits.push((s >>> 16) & 1 ? 1 : 0); }
    bits[1] = 1; bits[7] = 1; // 비지 않게
    return bits;
  });
  function glyph(x, y, id, c, a) {
    const b = GLY[id % GLY.length];
    for (let k = 0; k < 15; k++) if (b[k]) box(x + (k % 3) * P, y + Math.floor(k / 3) * P, P, c, a);
  }

  function setup() {
    if (cv) return;
    cv = document.createElement("canvas");
    cv.className = "dg-canvas";
    document.body.appendChild(cv);
    g = cv.getContext("2d");
  }
  function resize() {
    W = cv.width = window.innerWidth;
    H = cv.height = window.innerHeight;
    P = Math.max(2, Math.round(W / 56)); // 펫이 커지면 픽셀도 커진다
  }

  /* ---------------- 장면 ---------------- */
  function scene(kind, col, power, dir, rnd) {
    const cx = W / 2, cy = H * 0.62; // 몸 가운데쯤(펫은 아래에 붙어 있다)
    const front = dir; // 1 오른쪽, -1 왼쪽
    // 장면에 쓸 조각을 미리 정한다 — 매 프레임 새로 뽑으면 지글거리기만 한다
    const code = Array.from({ length: 5 + power * 2 }, () => ({ x: rnd() * W, v: 0.6 + rnd() * 0.8, id: Math.floor(rnd() * 16), d: rnd() * 0.25 }));
    const bits = Array.from({ length: 14 + power * 10 }, () => ({ a: rnd() * Math.PI * 2, v: 0.25 + rnd() * 0.75, s: rnd() < 0.3 ? 2 : 1, c: Math.floor(rnd() * 3) }));
    const cuts = [0, 1, 2].map((i) => ({ y: cy - H * 0.22 + i * H * 0.17 + (rnd() - 0.5) * H * 0.06, d: i * 0.08 }));

    return function draw(t) {
      g.clearRect(0, 0, W, H);
      // 1) 디지코드가 등 뒤로 솟는다(처음 절반)
      if (t < 0.6) {
        for (const c of code) {
          const k = Math.max(0, (t - c.d) / 0.5);
          if (k <= 0 || k > 1) continue;
          const y = H - k * H * c.v * 1.1;
          for (let j = 0; j < 4; j++) glyph(c.x, y + j * 6 * P, c.id + j, j ? col[1] : col[2], (1 - k) * (j ? 0.5 : 0.95));
        }
      }
      const k = (t - 0.28) / 0.6; // 기술 본체
      if (k <= 0 || k > 1) return;
      const fade = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;

      if (kind === "beam") {
        // 계단 진 광선 — 몸에서 앞쪽 끝까지, 두께가 고르지 않게 떨린다
        const x0 = W * 0.2; // 몸 앞쪽 끝에서 나간다 — 가운데서 쏘면 얼굴을 덮는다
        const len = Math.min(1, k / 0.35) * (W * 0.5 - x0) + 0;
        const half = P * (1 + power * 0.6) * (1 + 0.25 * Math.sin(k * 40));
        for (let x = 0; x < len; x += P) {
          const jag = (Math.sin((x + k * 300) * 0.3) > 0.6 ? P : 0);
          const xx = cx + front * (x0 + x);
          for (let y = -half - jag; y <= half + jag; y += P) box(xx, cy - H * 0.08 + y, P, Math.abs(y) < half * 0.45 ? col[2] : col[0], fade * (Math.abs(y) < half * 0.45 ? 1 : 0.85));
        }
        // 스캔선 — 광선 위를 지나가는 밝은 칸
        if (k < 0.7) for (let i = 0; i < 3; i++) box(cx + front * (x0 + ((k * 3 + i * 0.33) % 1) * len), cy - H * 0.08 - half, P * 2, "#ffffff", 0.9 * fade);
        // 맞는 자리(창 끝) — 네모 파편
        if (k > 0.3) {
          const e = (k - 0.3) / 0.7;
          for (const b of bits.slice(0, 10 + power * 4)) {
            const r = e * W * 0.35 * b.v;
            box(cx + front * W * 0.46 + Math.cos(b.a) * r * 0.6, cy - H * 0.08 + Math.sin(b.a) * r, P * b.s, col[b.c], (1 - e) * fade);
          }
        }
      } else if (kind === "slash") {
        // 계단 진 사선 세 줄 — 차례로 긋고, 끝나면 칸칸이 흩어진다
        for (const c of cuts) {
          const e = Math.max(0, Math.min(1, (k - c.d) / 0.3));
          if (!e) continue;
          const x0 = cx + front * (-W * 0.05), x1 = cx + front * W * 0.48;
          const y0 = c.y - H * 0.12, y1 = c.y + H * 0.12;
          const xe = x0 + (x1 - x0) * e, ye = y0 + (y1 - y0) * e;
          const scatter = k > 0.55 ? (k - 0.55) / 0.45 : 0;
          if (scatter) {
            const n = 16 + power * 4;
            for (let i = 0; i < n; i++) {
              const u = i / n, ox = x0 + (x1 - x0) * u, oy = y0 + (y1 - y0) * u;
              box(ox + Math.sin(i * 7) * scatter * W * 0.12, oy + Math.cos(i * 5) * scatter * H * 0.12 + scatter * H * 0.1, P, col[i % 3], 1 - scatter);
            }
          } else {
            stairs(x0, y0, xe, ye, col[0], fade, 2);
            stairs(x0, y0 - P, xe, ye - P, col[2], 0.9 * fade, 1);
          }
        }
      } else if (kind === "hex") {
        // 육각형 결계 — 몸을 둘러 두 겹이 펴졌다 깜빡인다
        for (let ring = 0; ring < 2; ring++) {
          const e = Math.min(1, Math.max(0, (k - ring * 0.15) / 0.4));
          const R = (H * 0.28 + ring * H * 0.1) * e;
          const blink = (Math.floor(k * 18) % 3 === 0) ? 0.45 : 1;
          for (let s = 0; s < 6; s++) {
            const a0 = (Math.PI / 3) * s + Math.PI / 6, a1 = a0 + Math.PI / 3;
            stairs(cx + Math.cos(a0) * R, cy - H * 0.1 + Math.sin(a0) * R, cx + Math.cos(a1) * R, cy - H * 0.1 + Math.sin(a1) * R, ring ? col[1] : col[0], fade * blink, 1);
          }
        }
        for (const b of bits.slice(0, 8 + power * 2)) box(cx + Math.cos(b.a) * H * 0.3, cy - H * 0.1 + Math.sin(b.a) * H * 0.3, P, col[2], fade * (Math.sin(k * 30 + b.a * 5) > 0 ? 1 : 0.2));
      } else {
        // 네모 조각이 격자를 따라 앞쪽으로 튀어 나간다 — 반은 몸 쪽으로 되돌아오며 깜빡인다
        for (const b of bits) {
          const r = k * W * 0.55 * b.v;
          const ang = b.a * 0.5 + (front > 0 ? -Math.PI / 4 : (Math.PI * 3) / 4);
          const on = Math.sin(k * 26 + b.a * 9) > -0.4;
          if (on) box(cx + Math.cos(ang) * r, cy - H * 0.1 + Math.sin(ang) * r, P * b.s, col[b.c], fade);
        }
      }
    };
  }

  /* ---------------- 이름 — 머리 위 터미널 창 ---------------- */
  function tag(name, col) {
    const el = document.createElement("div");
    el.className = "dg-tag";
    el.style.setProperty("--c", col[0]);
    document.body.appendChild(el);
    const text = "▶ " + String(name).toUpperCase().slice(0, 26);
    let i = 0;
    const iv = setInterval(() => {
      i++;
      el.textContent = text.slice(0, i) + (i < text.length ? "█" : "");
      if (i >= text.length) clearInterval(iv);
    }, 38);
    setTimeout(() => el.classList.add("out"), 2600);
    setTimeout(() => { clearInterval(iv); el.remove(); }, 3000);
  }

  /**
   * 쓴다. move = { name, attr, power(1~4) }, opts = { body(움직일 몸), dir(앞쪽 -1 · 1) }.
   * 이미 쓰는 중이면 false — 겹치면 알아볼 수 없다
   */
  function play(move, opts = {}) {
    if (busy || !move) return false;
    busy = true;
    setup();
    resize();
    const col = colorOf(move.attr);
    const power = Math.max(1, Math.min(4, move.power || 1));
    const dir = opts.dir || 1;
    let seed = [...String(move.name)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) ^ Date.now();
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const draw = scene(kindOf(move.name), col, power, dir, rnd);
    tag(move.name, col);

    const body = opts.body;
    if (body) {
      body.style.setProperty("--dir", dir);
      body.style.setProperty("--c1", col[0]);
      body.style.setProperty("--c2", col[1]);
      body.classList.remove("dg-glitch");
      void body.offsetWidth;
      body.classList.add("dg-glitch");
    }
    if (power >= 4) document.body.classList.add("dg-shake");

    const t0 = performance.now();
    const step = (now) => {
      const t = (now - t0) / DURATION;
      if (t >= 1) {
        g.clearRect(0, 0, W, H);
        if (body) body.classList.remove("dg-glitch");
        document.body.classList.remove("dg-shake");
        busy = false;
        raf = 0;
        return;
      }
      draw(t);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return true;
  }

  window.ptbDigiFx = { play, kindOf, DURATION };
})();
