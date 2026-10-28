"use strict";
/**
 * 레이드 방 전체 연출 — 쏜 기술이 보스까지 날아가 맞는 장면.
 *
 * moves.js 의 무대는 아이 몸 둘레만큼이라 기술이 그 자리에서 터지고 끝난다. 보스는 방 건너편에 있어서
 * "때렸다"가 안 보였다. 방 전체에 캔버스를 하나 깔고 그 사이를 그린다:
 *   구슬  특수 기술 — 빛나는 구슬이 꼬리를 끌며 날아가 맞는다
 *   광선  이름이 빔 · 광선 · 파동 · 캐논인 기술 — 시작점에서 보스까지 굵은 빛줄기
 *   충돌  맞는 자리 — 번쩍임 · 퍼지는 고리 · 튀는 불꽃(물리는 베인 자국 둘을 더한다)
 * 빛은 더하기 합성(lighter)으로 겹친다 — 겹칠수록 밝아져서 납작한 색 덩어리처럼 보이지 않는다.
 *
 * 그리는 동안만 requestAnimationFrame 을 돌리고 다 사라지면 멈춘다.
 */
(function () {
  const PI2 = Math.PI * 2;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const easeOut = (t) => 1 - (1 - t) * (1 - t);
  const easeIn = (t) => t * t;
  const BEAM = /빔|광선|파동|캐논|레이저|하이퍼|솔라|파괴광선|오로라|시그널|전자포|하이드로펌프|화염방사|불대문자|냉동빔|10만볼트/;

  /** "#rrggbb" → "rgba(r,g,b,a)" */
  function rgba(hex, a) {
    const h = String(hex).replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
  }

  function create(canvas, room) {
    const ctx = canvas.getContext("2d");
    let W = 0, H = 0, raf = 0;
    const parts = []; // (now) → 살아 있으면 true

    function size() {
      const r = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      W = r.width;
      H = r.height;
    }
    function loop(now) {
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      // 프레임 시각(now)이 연출을 더한 시각보다 조금 앞설 수 있다 — 각 연출은 0 아래로 내려가지 않게 센다.
      // 하나가 실패해도 루프는 계속 돈다(멈추면 그 뒤 연출이 다 안 보인다)
      for (let i = parts.length - 1; i >= 0; i--) {
        let alive = false;
        try { alive = parts[i](now); } catch { alive = false; }
        if (!alive) parts.splice(i, 1);
      }
      ctx.globalCompositeOperation = "source-over";
      raf = parts.length ? requestAnimationFrame(loop) : 0;
      if (!raf) ctx.clearRect(0, 0, W, H);
    }
    function add(fn) {
      if (!raf) size();
      parts.push(fn);
      if (!raf) raf = requestAnimationFrame(loop);
    }
    const sc = () => Math.max(0.6, W / 720); // 방이 커지면 연출도 크게

    /** 둥근 빛 — 가운데는 희고 바깥으로 타입 색이 번진다 */
    function glow(x, y, r, color, a) {
      if (r <= 0 || a <= 0) return;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${Math.min(1, a)})`);
      g.addColorStop(0.28, rgba(color, a * 0.9));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, PI2);
      ctx.fill();
    }

    /** 맞는 자리 — 번쩍임 · 고리 · 튀는 불꽃. slash 면 베인 자국 둘을 더한다 */
    function impact(p, colors, power = 60, slash = false, small = false) {
      const k = sc() * (small ? 0.55 : 1) * (0.75 + Math.min(150, power || 60) / 200);
      const t0 = performance.now();
      add((now) => {
        const t = Math.max(0, now - t0) / 280;
        if (t >= 1) return false;
        glow(p.x, p.y, (24 + 40 * easeOut(t)) * k, colors[0], 1 - t);
        return true;
      });
      add((now) => {
        const t = Math.max(0, now - t0) / 460;
        if (t >= 1) return false;
        ctx.strokeStyle = rgba(colors[0], (1 - t) * 0.9);
        ctx.lineWidth = Math.max(0.5, 5 * (1 - t) * k);
        ctx.beginPath();
        ctx.arc(p.x, p.y, (10 + 70 * easeOut(t)) * k, 0, PI2);
        ctx.stroke();
        return true;
      });
      const n = Math.round((small ? 6 : 12) + (power || 60) / 12);
      for (let i = 0; i < n; i++) {
        const ang = rnd(0, PI2);
        const sp = rnd(120, 360) * k;
        const life = rnd(300, 560);
        const c = pick(colors);
        add((now) => {
          const t = Math.max(0, now - t0) / life;
          if (t >= 1) return false;
          const d = sp * easeOut(t) * (life / 1000);
          const x = p.x + Math.cos(ang) * d, y = p.y + Math.sin(ang) * d + 40 * t * t * k;
          const tail = 10 * k * (1 - t);
          ctx.strokeStyle = rgba(c, 1 - t);
          ctx.lineWidth = Math.max(0.5, 2.4 * k * (1 - t));
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(x - Math.cos(ang) * tail, y - Math.sin(ang) * tail);
          ctx.lineTo(x, y);
          ctx.stroke();
          return true;
        });
      }
      if (slash) {
        // 베인 자국 — 엇갈린 흰 획 둘이 빠르게 그어졌다 사라진다
        for (const [a, d] of [[-0.7, 0], [0.7, 70]]) {
          add((now) => {
            const t = (now - t0 - d) / 260;
            if (t < 0) return true;
            if (t >= 1) return false;
            const L = 46 * k, grow = Math.min(1, t * 3);
            ctx.strokeStyle = `rgba(255,255,255,${1 - t})`;
            ctx.lineWidth = 3.5 * k * (1 - t);
            ctx.beginPath();
            ctx.moveTo(p.x - Math.cos(a) * L, p.y - Math.sin(a) * L);
            ctx.lineTo(p.x - Math.cos(a) * L + Math.cos(a) * 2 * L * grow, p.y - Math.sin(a) * L + Math.sin(a) * 2 * L * grow);
            ctx.stroke();
            return true;
          });
        }
      }
    }

    /** 구슬 — 꼬리를 끌며 날아가 맞는다 */
    function orb(from, to, colors, power, done) {
      const k = sc() * (0.8 + Math.min(150, power || 60) / 300);
      const t0 = performance.now();
      const dur = 300;
      const trail = [];
      add((now) => {
        const t = Math.min(1, Math.max(0, now - t0) / dur);
        const e = easeIn(t);
        const x = from.x + (to.x - from.x) * e;
        const y = from.y + (to.y - from.y) * e - Math.sin(Math.PI * t) * 26 * k; // 살짝 포물선
        trail.push({ x, y, at: now });
        while (trail.length && now - trail[0].at > 160) trail.shift();
        for (const q of trail) {
          const a = 1 - (now - q.at) / 160;
          glow(q.x, q.y, 9 * k * a, pick(colors), a * 0.55);
        }
        glow(x, y, 16 * k, colors[0], 1);
        if (t >= 1) { done && done(); return false; }
        return true;
      });
    }

    /** 광선 — 굵은 빛줄기가 보스까지 이어졌다가 가늘어지며 사라진다 */
    function beam(from, to, colors, power, done) {
      const k = sc() * (0.8 + Math.min(150, power || 60) / 250);
      const t0 = performance.now();
      const dur = 520;
      let hit = false;
      add((now) => {
        const t = Math.max(0, now - t0) / dur;
        if (t >= 1) return false;
        const reach = Math.min(1, t * 4); // 앞 1/4 동안 뻗어 나간다
        const x = from.x + (to.x - from.x) * reach, y = from.y + (to.y - from.y) * reach;
        const fade = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
        const wob = 1 + Math.sin(now / 28) * 0.12;
        ctx.lineCap = "round";
        for (const [w, c, a] of [[22, colors[0], 0.28], [10, colors[1] || colors[0], 0.7], [3.5, "#ffffff", 1]]) {
          ctx.strokeStyle = c === "#ffffff" ? `rgba(255,255,255,${a * fade})` : rgba(c, a * fade);
          ctx.lineWidth = w * k * wob * fade;
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        glow(from.x, from.y, 18 * k * fade, colors[0], fade);
        if (reach >= 1 && !hit) { hit = true; done && done(); }
        return true;
      });
    }

    /** 방 흔들림 — 위력이 셀 때 */
    function shake() {
      room.classList.remove("shake");
      void room.offsetWidth;
      room.classList.add("shake");
      setTimeout(() => room.classList.remove("shake"), 500);
    }

    /**
     * 아이 한 마리가 보스에게 기술을 쓴다.
     *   from  { x, y } 쏘는 자리(방 좌표)   to  { x, y } 맞는 자리
     *   move  { name, typeKey, damageClass, power }   colors  타입 색
     * 물리는 moves.js 가 들이받는 순간(250ms)에, 특수는 기를 다 모은 순간(560ms)에 터진다 — 그 박자에 맞춘다
     */
    function attack(from, to, move, colors) {
      const cls = move.damageClass || "status";
      if (cls === "status") return;
      const power = move.power || 60;
      if (cls === "physical") {
        setTimeout(() => { impact(to, colors, power, true); if (power >= 100) shake(); }, 250);
        return;
      }
      setTimeout(() => {
        const hit = () => { impact(to, colors, power); if (power >= 100) shake(); };
        if (BEAM.test(move.name || "")) beam(from, to, colors, power, hit);
        else orb(from, to, colors, power, hit);
      }, 560);
    }

    /** 보스의 기술이 모두에게 — 기를 모은 뒤 맞는 아이마다 작은 충돌 */
    function blast(targets, move, colors) {
      if ((move.damageClass || "status") === "status") return;
      const power = move.power || 60;
      setTimeout(() => {
        if (power >= 100) shake();
        targets.forEach((p) => setTimeout(() => impact(p, colors, power, move.damageClass === "physical", true), rnd(0, 180)));
      }, 480);
    }

    return { attack, blast, impact };
  }

  window.ptbRaidFx = { create, rgba };
})();
