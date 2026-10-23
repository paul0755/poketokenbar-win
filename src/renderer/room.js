"use strict";
/**
 * 미니룸 탭 — 내 방을 그리고 꾸민다. 무엇을 가졌는지는 메인(main/room.js)이 정한다.
 *
 * 가구·배경은 SVG 와 CSS 로 직접 그린 것이다(원작 그림은 쓰지 않는다). 포켓몬은 박스와
 * 같은 움직이는 스프라이트를 쓴다.
 *
 * 30초마다 갱신이 오지만 방은 바뀐 게 있을 때만 다시 그린다 — 매번 그리면 걷던
 * 아이들이 제자리로 돌아간다.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  let last = null;
  let sceneKey = "";

  /* ---------------- 가구 그림 ---------------- */

  // style 은 방 안에서의 자리(%). viewBox 는 그림 자체의 좌표
  const ART = {
    window: `<svg viewBox="0 0 120 90" style="left:9%; top:18%; width:19%;">
      <defs><linearGradient id="rmSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--rm-sky1)"/><stop offset="1" stop-color="var(--rm-sky2)"/></linearGradient></defs>
      <rect width="120" height="90" rx="4" fill="#7a4e2a"/><rect x="6" y="6" width="108" height="78" fill="url(#rmSky)"/>
      <circle class="rm-sun" cx="88" cy="26" r="11"/>
      <g fill="#ffffffcc"><rect x="18" y="22" width="26" height="8" rx="4"/><rect x="26" y="17" width="14" height="8" rx="4"/></g>
      <g class="rm-sea"><rect x="6" y="58" width="108" height="26" fill="#1e88e5"/><rect x="6" y="58" width="108" height="3" fill="#90caf9"/><rect x="20" y="66" width="18" height="2" fill="#bbdefb"/><rect x="62" y="72" width="22" height="2" fill="#bbdefb"/></g>
      <rect x="58" y="6" width="4" height="78" fill="var(--rm-win)"/><rect x="6" y="43" width="108" height="4" fill="var(--rm-win)"/>
      <rect x="-4" y="84" width="128" height="7" rx="2" fill="#5e3a1d"/></svg>`,
    lamp: `<svg viewBox="0 0 40 110" style="left:1.5%; top:35%; width:6.5%;">
      <ellipse class="rm-glow" cx="20" cy="22" rx="30" ry="26" fill="#ffe08255"/>
      <path d="M6 30 L12 8 H28 L34 30z" fill="#ffcc80" stroke="#c77c2a" stroke-width="2"/>
      <rect x="18" y="30" width="4" height="70" fill="#5d4037"/><rect x="8" y="100" width="24" height="6" rx="2" fill="#4e342e"/></svg>`,
    shelf: `<svg viewBox="0 0 80 100" style="left:75%; top:37%; width:13%;">
      <rect width="80" height="100" rx="3" fill="#8d6e63"/><rect x="5" y="5" width="70" height="90" fill="#5d4037"/>
      <rect x="5" y="34" width="70" height="4" fill="#8d6e63"/><rect x="5" y="66" width="70" height="4" fill="#8d6e63"/>
      <g stroke="#0005" stroke-width="1">
        <circle cx="18" cy="22" r="9" fill="#e0e0e0"/><circle cx="18" cy="22" r="2.5" fill="#5d4037"/>
        <circle cx="38" cy="22" r="9" fill="#ef9a9a"/><circle cx="38" cy="22" r="2.5" fill="#5d4037"/>
        <circle cx="58" cy="22" r="9" fill="#90caf9"/><circle cx="58" cy="22" r="2.5" fill="#5d4037"/>
        <circle cx="18" cy="54" r="9" fill="#a5d6a7"/><circle cx="18" cy="54" r="2.5" fill="#5d4037"/>
        <circle cx="38" cy="54" r="9" fill="#ce93d8"/><circle cx="38" cy="54" r="2.5" fill="#5d4037"/></g>
      <rect x="12" y="76" width="8" height="18" fill="#ffcc80"/><rect x="22" y="78" width="7" height="16" fill="#80cbc4"/><rect x="31" y="75" width="9" height="19" fill="#ef9a9a"/></svg>`,
    rug: `<svg viewBox="0 0 300 60" style="left:24%; top:76%; width:50%;">
      <ellipse cx="150" cy="30" rx="148" ry="28" fill="#c62828"/><ellipse cx="150" cy="30" rx="132" ry="22" fill="#ef5350"/>
      <ellipse cx="150" cy="30" rx="100" ry="15" fill="none" stroke="#ffcdd2" stroke-width="3" stroke-dasharray="8 6"/></svg>`,
    cushion: `<svg viewBox="0 0 60 50" style="left:10%; top:80%; width:9%;">
      <ellipse cx="30" cy="46" rx="26" ry="4" fill="#0003"/>
      <path d="M4 26 a26 22 0 0 1 52 0z" fill="#e53935"/><path d="M4 26 a26 22 0 0 0 52 0z" fill="#fafafa"/>
      <rect x="4" y="24" width="52" height="4" fill="#212121"/><circle cx="30" cy="26" r="7" fill="#fafafa" stroke="#212121" stroke-width="3"/></svg>`,
    plant: `<svg viewBox="0 0 50 80" style="left:89%; top:60%; width:8%;">
      <path d="M10 52 h30 l-4 26 h-22z" fill="#d84315"/><rect x="8" y="48" width="34" height="7" rx="2" fill="#bf360c"/>
      <rect x="23" y="20" width="4" height="30" fill="#558b2f"/>
      <ellipse cx="15" cy="26" rx="10" ry="6" fill="#7cb342" transform="rotate(-25 15 26)"/><ellipse cx="35" cy="22" rx="10" ry="6" fill="#7cb342" transform="rotate(25 35 22)"/>
      <circle cx="17" cy="14" r="6" fill="#e53935"/><circle cx="33" cy="10" r="6" fill="#1e88e5"/><circle cx="26" cy="5" r="5" fill="#fdd835"/></svg>`,
  };

  /** 기록 장식 — 사지 않는다. 숫자는 그때그때 들어간다 */
  const dexFrame = (seen, total) => `<svg viewBox="0 0 70 56" style="left:31%; top:11%; width:11%;">
      <rect width="70" height="56" rx="3" fill="#c9a227"/><rect x="5" y="5" width="60" height="46" fill="#fffaf0"/>
      <circle cx="35" cy="21" r="10" fill="#e53935"/><rect x="25" y="20" width="20" height="2.5" fill="#222"/><circle cx="35" cy="21" r="3.5" fill="#fff" stroke="#222" stroke-width="1.5"/>
      <text x="35" y="44" font-size="8" text-anchor="middle" fill="#333" font-weight="700" font-family="sans-serif">도감 ${seen}/${total}</text></svg>`;

  // 승수가 쌓이면 배지가 하나씩 빛난다 — 1승, 10승, 30승, 100승
  const BADGE_AT = [1, 10, 30, 100];
  const badgeCase = (wins) => {
    const lit = BADGE_AT.filter((n) => wins >= n).length;
    const b = (i, shape) => `<g opacity="${i < lit ? 1 : 0.18}">${shape}</g>`;
    return `<svg viewBox="0 0 92 40" style="left:45%; top:13%; width:15%;">
      <rect width="92" height="40" rx="3" fill="#4e342e"/><rect x="4" y="4" width="84" height="32" fill="#2b1d19"/>
      <g stroke="#0006" stroke-width="1">
        ${b(0, '<polygon points="16,12 22,20 16,28 10,20" fill="#b0bec5"/>')}
        ${b(1, '<circle cx="34" cy="20" r="7" fill="#ffca28"/>')}
        ${b(2, '<polygon points="52,12 59,20 52,28 45,20" fill="#4fc3f7"/>')}
        ${b(3, '<rect x="64" y="13" width="14" height="14" rx="3" fill="#ef5350"/>')}</g>
      <text x="46" y="38.5" font-size="4.5" text-anchor="middle" fill="#ffffffaa" font-family="sans-serif">결투 ${wins}승</text></svg>`;
  };

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  const trophy = (count, name) => `<svg viewBox="0 0 110 70" style="right:5%; top:10%; width:19%;">
      <rect x="0" y="54" width="110" height="7" fill="#6d4c41"/><rect x="6" y="61" width="5" height="9" fill="#4e342e"/><rect x="99" y="61" width="5" height="9" fill="#4e342e"/>
      <g transform="translate(14,10)">
        <path d="M6 0 h26 v10 a13 13 0 0 1 -26 0z" fill="#ffd54f" stroke="#c49000" stroke-width="2"/>
        <path d="M6 4 h-6 v4 a6 6 0 0 0 6 6" fill="none" stroke="#c49000" stroke-width="2.5"/><path d="M32 4 h6 v4 a6 6 0 0 1 -6 6" fill="none" stroke="#c49000" stroke-width="2.5"/>
        <rect x="15" y="22" width="8" height="10" fill="#c49000"/><rect x="9" y="32" width="20" height="6" fill="#8d6e63"/>
        <text x="19" y="14" font-size="7" text-anchor="middle" fill="#8a5a00" font-weight="800" font-family="sans-serif">${count > 1 ? count : "★"}</text></g>
      <g transform="translate(64,22)">
        <rect width="30" height="32" rx="2" fill="#90a4ae"/><rect x="3" y="3" width="24" height="26" fill="#eceff1"/>
        <text x="15" y="14" font-size="5.5" text-anchor="middle" fill="#455a64" font-family="sans-serif">졸업</text>
        <text x="15" y="23" font-size="${String(name).length > 4 ? 4 : 5}" text-anchor="middle" fill="#455a64" font-weight="700" font-family="sans-serif">${esc(name)}</text></g></svg>`;

  /* ---------------- 포켓몬 자리 ---------------- */

  // 발이 닿는 높이(bottom, 방 높이의 %)와 걷는 모양. 서로 덜 겹치게 흩어 두었다
  const SLOTS = [
    { left: 20, bottom: 85, walk: "rm-walkB", dur: 14 },
    { left: 62, bottom: 83, walk: "rm-walkA", dur: 11 },
    { left: 42, bottom: 90, walk: "rm-walkB", dur: 17 },
    { left: 72, bottom: 93, walk: "rm-walkC", dur: 9 },
    { left: 33, bottom: 96, walk: "rm-walkC", dur: 13 },
  ];
  const SIZE = { baby: 10.5, mid: 12.5, final: 15, master: 15 }; // 방 너비의 %
  // 방은 16:10 이라 너비 1% 가 높이 1.6% 다
  const topFor = (bottom, h) => bottom - h * 1.6;

  function monHtml(m, slot, sit) {
    const h = SIZE[m.stageKey] || 12;
    const pos = sit ? { left: 9.8, bottom: 88 } : slot;
    const lv = m.profile ? ` · Lv.${m.profile.level}` : "";
    const tag = `${m.name}${m.shiny ? " ★" : ""}${lv}${m.active ? " · 키우는 중" : ""}${sit ? " · 쉬는 중" : ""}`;
    const spark = m.shiny ? '<i class="rm-spark" style="left:6px; top:4px"></i><i class="rm-spark" style="right:2px; top:22px; animation-delay:.6s"></i>' : "";
    return `<div class="rm-mon${sit ? " sit" : ""}" style="left:${pos.left}%; top:${topFor(pos.bottom, h)}%; --h:${h}; --walk:${slot.walk}; --dur:${slot.dur}s;">
        <div class="rm-body"><img src="${esc(m.animUrl || m.url || "")}" alt=""><div class="rm-shadow"></div></div>
        <div class="rm-tag">${esc(tag)}</div>${spark}</div>`;
  }

  /* ---------------- 그리기 ---------------- */

  function renderScene(s) {
    const R = s.room;
    const on = new Set(R.furni.filter((f) => f.on).map((f) => f.id));
    const mons = R.mons.map((id) => (s.box || []).find((m) => m.id === id)).filter(Boolean);
    // 쿠션이 있으면 가장 작은 아이 하나가 올라앉는다
    const sitter = on.has("cushion") && mons.length
      ? mons.reduce((a, m) => ((SIZE[m.stageKey] || 12) < (SIZE[a.stageKey] || 12) ? m : a), mons[mons.length - 1])
      : null;
    const dex = s.dex || { seen: 0, total: 0 };

    const key = JSON.stringify([R.theme, [...on], mons.map((m) => [m.id, m.animUrl, m.name, m.profile && m.profile.level, m.active]), dex.seen, R.wins, R.graduated, R.lastGrad, s.friend && s.friend.trainer]);
    if (key === sceneKey) return;
    sceneKey = key;

    let slot = 0;
    const html = [
      '<div class="rm-wall"></div><div class="rm-floor"></div>',
      on.has("window") ? ART.window : "",
      dexFrame(dex.seen, dex.total),
      R.wins > 0 ? badgeCase(R.wins) : "",
      R.graduated > 0 ? trophy(R.graduated, R.lastGrad || "") : "",
      ...["lamp", "shelf", "rug", "cushion", "plant"].map((id) => (on.has(id) ? ART[id] : "")),
      ...mons.map((m) => (m === sitter ? monHtml(m, SLOTS[0], true) : monHtml(m, SLOTS[slot++ % SLOTS.length], false))),
      mons.length ? "" : '<div class="rm-empty">아래에서 방에 둘 포켓몬을 골라 주세요</div>',
      `<div class="rm-plate"><b>${esc((s.friend && s.friend.trainer) || "나")}</b>의 방<br>도감 ${dex.seen} · 졸업 ${R.graduated}</div>`,
    ].join("");
    const el = $("rmRoom");
    el.dataset.theme = R.theme;
    el.innerHTML = html;
  }

  function renderPanel(s) {
    const R = s.room;
    const left = s.candy ? s.candy.left : 0;
    $("rmWallet").textContent = "🍬 " + left;

    $("rmThemes").innerHTML = R.themes
      .map((t) => t.owned
        ? `<button data-theme="${t.id}" class="${t.id === R.theme ? "on" : ""}">${t.icon} ${t.name}</button>`
        : `<button data-buy-theme="${t.id}" ${left < t.cost ? "disabled" : ""}>${t.icon} ${t.name}<span class="c">🍬${t.cost}</span></button>`)
      .join("");

    $("rmFurni").innerHTML = R.furni
      .map((f) => `<div class="it"><span class="ic">${f.icon}</span><span class="t">${f.name}<span>${f.desc}</span></span>${
        f.owned
          ? `<button data-toggle="${f.id}">${f.on ? "치우기" : "놓기"}</button>`
          : `<button class="buy" data-buy-furni="${f.id}" ${left < f.cost ? "disabled" : ""}>🍬${f.cost}</button>`
      }</div>`)
      .join("");

    const dex = s.dex || { seen: 0, total: 0 };
    const next = BADGE_AT.find((n) => R.wins < n);
    $("rmRec").innerHTML = [
      `🖼️ <b>도감 액자</b> — 도감 ${dex.seen}/${dex.total}. 만날수록 숫자가 오른다`,
      `🏅 <b>결투 배지 진열장</b> — ${R.wins}승${next ? ` · ${next}승이면 배지가 하나 더 빛난다` : " · 배지를 다 모았다"}`,
      `🏆 <b>졸업 트로피</b> — ${R.graduated ? `${R.graduated}마리 졸업 (마지막: ${esc(R.lastGrad)})` : "마스터까지 키우면 생긴다"}`,
    ].join("<br>");

    const pickable = (s.box || []).filter((m) => m.stageKey !== "egg");
    const inRoom = new Set(R.mons);
    $("rmMonsCount").textContent = `${R.mons.length}/${R.max}`;
    $("rmMons").innerHTML = pickable
      .map((m) => `<button data-mon="${m.id}" class="${inRoom.has(m.id) ? "on" : ""}" ${!inRoom.has(m.id) && R.mons.length >= R.max ? "disabled" : ""}>${m.url ? `<img src="${esc(m.url)}" alt="">` : ""}${esc(m.name)}</button>`)
      .join("") || '<span class="rm-rec">알만 있습니다. 부화하면 방에 둘 수 있습니다.</span>';
  }

  function render(s) {
    if (!s || !s.room) return;
    last = s;
    renderScene(s);
    renderPanel(s);
  }

  /* ---------------- 누르기 ---------------- */

  const done = (r) => {
    if (!r || !r.ok) toast((r && r.reason) || "하지 못했습니다", "bad");
    else if (r.message) toast(r.message);
  };

  $("rmRoom").addEventListener("click", (e) => {
    const m = e.target.closest(".rm-mon");
    if (m) m.classList.toggle("show");
  });

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
