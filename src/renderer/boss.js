"use strict";
/**
 * 보스 탭 — 길드 레이드. 레이드 방에 보스가 서 있고, 내 아이 한 마리와 길드원들의 대표 포켓몬이 모여 있다.
 *
 * 길드원마다 한 마리씩 나간다. 선반(내 박스)에서 아이를 끌어 보스 위에 놓으면(또는 골라 두고 ⚔️ 도전)
 * 모두가 한꺼번에 보스와 싸운다. 내 아이가 쓰러지면 판이 멈추고, 선반에서 다음 아이를 골라 내보내면
 * 이어서 싸운다(한 도전에 limit 마리까지). 결과는 메인이 토막마다 계산해 둔다(main/raidbattle.js) — 여기서는
 * 그 사건 목록을 아이들이 돌아다니며 기술을 쓰는 모습으로 재생만 한다. 기술 연출은 펫 · 결투 탭과 같은
 * moves.js — 아이마다 작은 무대를 하나씩 붙인다. 건너뛰어도 결과는 같다.
 *
 * 서버와 이야기하는 건 메인(index.js 길드 레이드 칸)이 한다.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const bars = (n) => String(Math.round(n / 10) / 100); // 천분율 → 칸 (1500 → 1.5)
  const LS = "ptb.raidPick";

  let last = null; // 마지막 갱신(onStats)
  let view = null; // 마지막으로 받은 레이드(raidView)
  let loading = false;
  let playing = false;
  let fast = false;
  let shards = null; // 내 전설의 조각 { shards, need, swapRate, legends } — 지갑에 있다
  let shardsBusy = false;
  let pick = (() => { try { return localStorage.getItem(LS) || null; } catch { return null; } })(); // 처음 내보낼 내 아이
  const savePick = () => { try { localStorage.setItem(LS, pick || ""); } catch {} };
  let choosing = null; // 내 아이가 쓰러져 다음 아이를 기다릴 때 { resolve, used, limit }
  let liveUsed = []; // 이번 도전에 나간 내 아이들 — 선반에서 흐리게

  const sleep = (ms) => (fast ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
  const myMons = () => ((last && last.box) || []).filter((m) => m.stageKey !== "egg" && m.profile);

  /* ---------------- 레이드 방 그림 ---------------- */

  /** 돌 동굴 · 횃불 · 보스가 서는 제단. 방 · 홀과 같은 픽셀 그림(320×180)이다 */
  function paintArena() {
    const c = $("bsCanvas");
    if (c.dataset.done) return;
    c.dataset.done = "1";
    const g = c.getContext("2d");
    const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    const W = 320, H = 180, F = 108;
    R(0, 0, W, F, "#3b3631");
    R(0, 0, W, 10, "#2a2622");
    // 벽돌
    for (let y = 12, row = 0; y < F - 4; y += 12, row++) {
      R(0, y, W, 1, "#2f2b27");
      for (let x = (row % 2) * 14; x < W; x += 28) R(x, y + 1, 1, 11, "#2f2b27");
    }
    // 금 간 돌, 이끼
    for (const [x, y] of [[30, 40], [120, 70], [250, 30], [190, 88]]) { R(x, y, 5, 1, "#24211e"); R(x + 4, y + 1, 1, 3, "#24211e"); }
    for (const [x, y, w] of [[0, 96, 18], [70, 100, 12], [150, 98, 16]]) R(x, y, w, 3, "#4a5a3a");
    // 바닥
    R(0, F, W, H - F, "#5b544b");
    R(0, F, W, 2, "#2a2622");
    for (let y = F + 12; y < H; y += 14) R(0, y, W, 1, "#4d4740");
    for (let y = F + 2, row = 0; y < H; y += 14, row++) for (let x = (row % 2) * 20; x < W; x += 40) R(x, y, 1, 12, "#4d4740");
    // 제단 — 보스 자리
    R(196, 128, 112, 10, "#7a7166");
    R(190, 138, 124, 12, "#6a6258");
    R(196, 128, 112, 2, "#958b7e");
    for (let x = 206; x < 300; x += 18) R(x, 142, 8, 2, "#b38cff");
    // 횃불
    for (const x of [44, 150, 270]) {
      R(x, 34, 4, 18, "#6b4a2a");
      R(x - 2, 32, 8, 3, "#4a3220");
      R(x - 1, 24, 6, 8, "#f08a24");
      R(x, 20, 4, 6, "#ffd24a");
      R(x + 1, 18, 2, 3, "#fff1b0");
      g.fillStyle = "rgba(255,170,60,0.08)";
      g.beginPath(); g.arc(x + 2, 30, 30, 0, Math.PI * 2); g.fill();
    }
  }

  /* ---------------- 방 안의 아이들 ---------------- */

  const actors = new Map(); // key → { el, x, y, home }
  let idleTimer = null;
  const rand = (a, b) => a + Math.random() * (b - a);

  function actorEl(key, url, tag, me) {
    const el = document.createElement("div");
    el.className = "bs-a" + (me ? " me" : "");
    el.dataset.key = key;
    // fxs — 기술 연출 무대(moves.js). bd — 기술을 쓸 때 움직이는 몸(그림은 오른쪽을 보게 뒤집혀 있다)
    el.innerHTML = `<div class="fxs"></div><span class="bd"><img alt="" draggable="false" /></span><span class="tg"></span><span class="hp"><i></i></span><span class="st"></span>`;
    el.querySelector("img").src = url || "";
    el.querySelector(".tg").textContent = tag;
    $("bsActors").appendChild(el);
    return el;
  }
  const put = (a, x, y) => {
    a.x = x; a.y = y;
    a.el.style.left = x + "%";
    a.el.style.top = y + "%";
    a.el.style.zIndex = Math.round(y * 10);
  };
  const spot = () => [rand(6, 52), rand(78, 95)]; // 자리는 발끝 — 그림 전체가 바닥(그림의 60% 아래)에 서게

  /** 기다리는 동안 — 내가 고른 아이와 길드원의 대표 포켓몬이 방 안을 어슬렁거린다 */
  function idleScene() {
    if (playing) return;
    const want = new Map();
    const m = myMons().find((x) => x.id === pick);
    if (m) want.set("m:" + m.id, { url: m.animUrl || m.url, tag: `나 · ${m.name}`, me: true });
    for (const x of (view && view.members) || []) want.set("g:" + x.id, { url: x.url, tag: `${x.trainer} · ${x.name}`, me: false });
    for (const [k, a] of actors) if (!want.has(k)) { a.el.remove(); actors.delete(k); }
    for (const [k, w] of want) {
      if (actors.has(k)) continue;
      const a = { el: actorEl(k, w.url, w.tag, w.me) };
      actors.set(k, a);
      put(a, ...spot());
    }
    sizeActors(actors.size);
    clearInterval(idleTimer);
    idleTimer = setInterval(() => {
      if (playing || $("tab-boss").hidden) return;
      for (const a of actors.values()) if (Math.random() < 0.4) put(a, ...spot());
    }, 1800);
  }
  /**
   * 아이 크기 — 방 너비에 맞춘다(창을 넓히면 같이 커진다). 많이 모이면 조금씩 작게.
   * 보스는 방 높이의 70% 남짓(boss.css .bs-boss)이라 아이들보다 서너 배 크다 — 한눈에 보스가 보이게
   */
  let actorCount = 0;
  function sizeActors(n = actorCount) {
    actorCount = n;
    const w = $("bsActors").clientWidth || 640;
    const k = n <= 6 ? 0.1 : n <= 10 ? 0.085 : n <= 16 ? 0.07 : 0.056;
    $("bsActors").style.setProperty("--s", Math.round(Math.max(40, w * k)) + "px");
  }
  window.addEventListener("resize", () => { if (!$("tab-boss").hidden) sizeActors(); });

  /* ---------------- 그리기 ---------------- */

  function bossHp(milli) {
    const rd = view && view.raid;
    const max = rd ? rd.max : Math.max(1, milli);
    $("bsHp").style.width = Math.max(0, Math.min(100, (milli / max) * 100)) + "%";
    $("bsHpn").textContent = rd && rd.done ? "이번 주 보스를 모두 쓰러뜨렸습니다" : `남은 체력 ${bars(milli)} / ${bars(max)}칸`;
  }

  function render() {
    const s = last;
    const online = Boolean(s && s.online && s.online.enabled);
    const g = s && s.guild;
    const inGuild = online && g && !g.gone;
    $("bsOff").hidden = Boolean(inGuild && view);
    $("bsIn").hidden = !(inGuild && view);
    if (!inGuild) {
      $("bsOff").textContent = !online
        ? "길드 레이드는 온라인 기능을 쓸 때만 열립니다. ⚙ 설정에서 온라인 기능을 켜 주세요."
        : "길드에 들어가면 길드원과 함께 레이드 보스에 도전할 수 있습니다. 방 탭의 🏰 길드에서 길드를 만들거나 들어가 주세요.";
      return;
    }
    if (!view) { $("bsOff").textContent = loading ? "레이드를 불러오는 중…" : "레이드를 불러오지 못했습니다."; return; }
    const rd = view.raid;
    paintArena();
    $("bsHead").textContent = `${view.name} · ${rd.done ? "이번 주 끝" : `${rd.stage}단계 / ${rd.stages}`} · 보스는 월요일 0시(한국 시간)에 바뀝니다`;
    $("bsBossImg").src = rd.url || "";
    $("bsBossName").textContent = `레이드 보스 ${rd.name}`;
    if (!playing) bossHp(rd.done ? 0 : rd.hp);
    $("bsTries").innerHTML = `오늘 남은 도전 <b>${rd.triesLeft}</b>/${rd.tries}`;
    renderPick();
    renderShelf();
    renderRank();
    $("bsShards").innerHTML = shardsHtml();
    if (!shards && !shardsBusy) loadShards();
    $("bsFoot").innerHTML = `길드원마다 한 마리씩 — <b>내 아이 한 마리</b>와 <b>길드원 ${view.members.length}명의 대표 포켓몬</b>이 한꺼번에 싸웁니다.
      내 아이가 쓰러지면 다음 아이를 골라 이어서 싸웁니다(한 도전에 ${view.lineup}마리까지, 10턴). Lv.50, 보스는 개체값이 모두 31입니다.
      깎은 칸은 그 포켓몬 주인의 기록입니다 — 내 대표 포켓몬(내 방의 첫 아이)도 남의 도전에서 함께 싸웁니다.
      한 단계를 쓰러뜨리면 그 단계에 조금이라도 깎은 길드원 모두 <b>${esc(rd.name)}의 조각</b> 1개(가장 많이 깎은 ${rd.topBonus}명은 2개).
      조각은 지갑에 들어가고 한 주에 한 길드에서만 받습니다${view.walletOk ? "" : ` · <span class="warn">내 지갑이 확인되면 들어갑니다</span>`}`;
    if (!playing) idleScene();
  }

  function monChip(m, cls = "") {
    return `<div class="bs-mon${cls}" data-id="${esc(m.id)}" title="${esc(m.name)} Lv.${m.profile.level}">
      <img src="${esc(m.animUrl || m.url || "")}" alt="" draggable="false" /><span>${esc(m.name)}</span><i>Lv.${m.profile.level}</i></div>`;
  }

  /** 처음 내보낼 아이 · 도전 단추. 고를 때(choosing)는 다음 아이를 고르라는 말 */
  function renderPick() {
    const mons = myMons();
    if (pick && !mons.some((m) => m.id === pick)) { pick = null; savePick(); } // 판 아이 · 맡긴 아이
    const m = mons.find((x) => x.id === pick);
    $("bsPick").innerHTML = m ? monChip(m, " on") : `<div class="bs-slot">아래에서 골라 주세요</div>`;
    const rd = view.raid;
    $("bsGo").disabled = playing || rd.done || rd.triesLeft <= 0 || !m;
    $("bsGo").textContent = playing ? "싸우는 중…" : rd.done ? "이번 주 끝" : rd.triesLeft <= 0 ? "내일 다시" : "⚔️ 도전";
    $("bsChoose").hidden = !choosing;
    if (choosing) $("bsChooseN").textContent = `${choosing.used.length} / ${choosing.limit}마리 나감`;
  }

  function renderShelf() {
    const used = new Set(choosing ? choosing.used : liveUsed);
    const list = myMons().sort((a, b) => b.profile.level - a.profile.level);
    $("bsShelf").innerHTML = list.length
      ? list.map((m) => monChip(m, used.has(m.id) ? " used" : m.id === pick && !playing ? " on" : "")).join("")
      : `<span class="sub">박스에 싸울 포켓몬이 없습니다(알은 싸울 수 없습니다)</span>`;
    $("bsShelf").classList.toggle("choose", Boolean(choosing));
  }

  function renderRank() {
    const rd = view.raid;
    const rows = rd.rows.filter((x) => x.d > 0);
    const got = (id) => rd.rewards.filter((x) => x.id === id).reduce((a, x) => a + x.n, 0);
    const cleared = rd.cleared.map((c) => `${c.stage}단계 ✓ ${esc(c.by)}`).join(" · ");
    $("bsRank").innerHTML = `<div class="hd"><b>이번 주 깎은 칸</b>${cleared ? `<span>${cleared}</span>` : ""}</div>` + (rows.length
      ? rows.slice(0, 10).map((x, i) => {
          const me = rd.mine && x.id === rd.mine.id;
          const help = x.h ? ` <i>도움 ${bars(x.h)}</i>` : "";
          const pcs = got(x.id) ? ` · 🧩${got(x.id)}` : "";
          return `<div class="r${me ? " me" : ""}"><span class="no">${i + 1}</span><span class="nm">${esc(x.trainer)}</span><span class="v">${bars(x.d)}칸${help}${pcs}</span></div>`;
        }).join("")
      : `<div class="sub">아직 아무도 도전하지 않았습니다</div>`);
  }

  function shardsHtml() {
    if (!shards) return `<div class="hd"><b>🧩 내 전설의 조각</b></div><span class="sub">불러오는 중…</span>`;
    const { need, swapRate: rate, shards: mine } = shards;
    const swapFrom = mine.filter((x) => x.n >= rate);
    const list = mine.map((x) => {
      const ready = x.n >= need;
      return `<div class="sh${ready ? " ready" : ""}">${x.url ? `<img src="${esc(x.url)}" alt="">` : ""}<span>${esc(x.name)}</span><b>${x.n}/${need}</b>${ready ? `<button data-redeem="${x.line}">받기</button>` : ""}</div>`;
    }).join("");
    const swap = swapFrom.length ? `<div class="sh-swap"><span class="sub">조각 바꾸기 — ${rate}개 → 1개</span>
        <select id="bsFrom">${swapFrom.map((x) => `<option value="${x.line}">${esc(x.name)} (${x.n})</option>`).join("")}</select> →
        <select id="bsTo">${shards.legends.map((x) => `<option value="${x.line}">${esc(x.name)}</option>`).join("")}</select>
        <button data-swap>바꾸기</button></div>` : "";
    return `<div class="hd"><b>🧩 내 전설의 조각</b></div>${mine.length ? `<div class="sh-list">${list}</div>` : `<span class="sub">아직 없습니다 — 레이드 보스를 쓰러뜨리면 생깁니다. 같은 전설의 조각 ${need}개면 그 전설을 받습니다</span>`}${swap}`;
  }

  async function loadShards() {
    shardsBusy = true;
    try {
      const r = await window.ptb.raidShards();
      if (r && r.ok) shards = r;
    } finally {
      shardsBusy = false;
    }
    if (view) $("bsShards").innerHTML = shardsHtml();
  }

  async function load() {
    if (loading || playing) return;
    const g = last && last.guild;
    if (!(last && last.online && last.online.enabled && g && !g.gone)) { view = null; render(); return; }
    loading = true;
    if (!view) render();
    try {
      const r = await window.ptb.raidView();
      if (r && r.ok) view = r;
      else if (r && !r.gone) toast((r && r.reason) || "레이드를 불러오지 못했습니다", "bad");
    } finally {
      loading = false;
    }
    render();
  }

  /* ---------------- 고르기 · 끌어 놓기 ---------------- */

  /** 선반의 아이를 골랐다 — 쓰러져 고르는 중이면 바로 내보내고, 아니면 처음 내보낼 아이로 */
  function choose(id, go) {
    if (choosing) {
      if (choosing.used.includes(id)) return toast("이번 도전에 이미 나갔던 아이입니다", "bad");
      const c = choosing;
      choosing = null;
      c.resolve(id);
      return;
    }
    if (playing) return;
    pick = id;
    savePick();
    render();
    if (go) challenge();
  }

  let drag = null;
  $("tab-boss").addEventListener("pointerdown", (e) => {
    const chip = e.target.closest("#bsShelf .bs-mon, #bsPick .bs-mon");
    if (!chip || chip.classList.contains("used") || (playing && !choosing) || e.button !== 0) return;
    e.preventDefault();
    drag = { chip, id: chip.dataset.id, sx: e.clientX, sy: e.clientY, ghost: null };
  });
  window.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.ghost) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
      drag.ghost = drag.chip.cloneNode(true);
      drag.ghost.className = "bs-mon bs-ghost";
      document.body.appendChild(drag.ghost);
      drag.chip.classList.add("lift");
    }
    drag.ghost.style.left = e.clientX + "px";
    drag.ghost.style.top = e.clientY + "px";
    const t = document.elementFromPoint(e.clientX, e.clientY);
    $("bsBoss").classList.toggle("drop", Boolean(t && t.closest("#bsBoss")));
  });
  window.addEventListener("pointerup", (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    $("bsBoss").classList.remove("drop");
    if (d.ghost) d.ghost.remove();
    d.chip.classList.remove("lift");
    // 끌지 않고 눌렀으면 고르기만(고르는 중이면 내보내기). 보스 위에 놓으면 바로 도전
    if (!d.ghost) return choose(d.id, false);
    const t = document.elementFromPoint(e.clientX, e.clientY);
    if (t && t.closest("#bsBoss")) choose(d.id, true);
  });

  /* ---------------- 도전 · 재생 ---------------- */

  /** 내 아이가 쓰러졌다 — 선반에서 다음 아이를 고르거나 그만할 때까지 기다린다 */
  function waitChoice(r) {
    return new Promise((resolve) => {
      fast = false;
      choosing = { resolve, used: r.used, limit: r.limit };
      renderPick();
      renderShelf();
      $("bsChoose").scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  async function challenge() {
    if (playing || !view) return;
    const rd = view.raid;
    if (rd.done) return toast("이번 주 레이드는 끝났습니다", "bad");
    if (rd.triesLeft <= 0) return toast("오늘 도전은 다 했습니다. 내일 다시 도전할 수 있습니다", "bad");
    if (!pick) return toast("아래 선반에서 내보낼 포켓몬을 골라 주세요", "bad");
    playing = true;
    fast = false;
    renderPick();
    let r;
    try {
      r = await window.ptb.raidAttack(pick);
      if (!r || !r.ok) return void toast((r && r.reason) || "도전하지 못했습니다", "bad");
      $("bsSkip").hidden = false;
      liveUsed = r.used;
      renderShelf();
      const scene = setupScene(r);
      await playSeg(scene, r);
      while (r.need) {
        const id = await waitChoice(r);
        renderPick();
        renderShelf();
        const n = await window.ptb.raidNext(id);
        if (!n || !n.ok) {
          toast((n && n.reason) || "내보내지 못했습니다", "bad");
          if (n && n.over) return; // 이미 끝난 도전 — 다시 부를 것 없다
          if (n && /이미 나갔던|골라 주세요/.test(n.reason || "")) continue; // 다시 고른다
          r = await window.ptb.raidNext(null); // 그만한다
          if (!r || !r.ok) return;
        } else r = n;
        liveUsed = r.used;
        renderShelf();
        await playSeg(scene, r);
      }
      await summary(r);
      if (r.raid && r.raid.cleared) shards = null; // 조각이 들어왔을 수 있다
    } finally {
      playing = false;
      choosing = null;
      liveUsed = [];
      $("bsSkip").hidden = true;
      if (view) { renderPick(); renderShelf(); }
      for (const a of actors.values()) a.el.remove();
      actors.clear();
    }
    await load();
  }
  $("bsStop").onclick = () => {
    if (!choosing) return;
    const c = choosing;
    choosing = null;
    c.resolve(null);
  };

  function logLine(text, cls = "") {
    if (!text) return;
    const el = document.createElement("div");
    el.textContent = text;
    if (cls) el.className = cls;
    $("bsLog").appendChild(el);
    $("bsLog").scrollTop = $("bsLog").scrollHeight;
  }
  function pop(x, y, text, cls = "") {
    if (fast) return;
    const p = document.createElement("div");
    p.className = "bs-pop " + cls;
    p.textContent = text;
    p.style.left = x + "%";
    p.style.top = y + "%";
    $("bsActors").appendChild(p);
    setTimeout(() => p.remove(), 900);
  }
  const blink = (el) => { el.classList.remove("hit"); void el.offsetWidth; el.classList.add("hit"); };

  /**
   * 기술 연출 — 아이는 오른쪽(보스 쪽), 보스는 왼쪽을 보고 쓴다. 몸 둘레는 moves.js 가,
   * 보스까지 날아가 맞는 데는 방 전체 캔버스(raidfx.js)가 그린다. targets — 보스가 때리는 아이들의 자리
   */
  let bossFx = null;
  let roomFx = null;
  /** 요소의 한 점을 방 좌표로 — fx · fy 는 그 요소 안의 비율 */
  function roomPt(el, fx = 0.5, fy = 0.5) {
    const R = $("bsRoom").getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - R.left + r.width * fx, y: r.top - R.top + r.height * fy };
  }
  function skill(a, move, targets = []) {
    if (fast || !window.ptbMoves) return;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce && window.ptbRaidFx) roomFx = roomFx || window.ptbRaidFx.create($("bsFx"), $("bsRoom"));
    const colors = window.ptbMoves.fxOf ? window.ptbMoves.fxOf(move.typeKey).c : ["#ffffff"];
    if (!a) {
      bossFx = bossFx || window.ptbMoves.create($("bsBossFx"));
      bossFx.play(move, { body: $("bsBossBody"), dir: -1, force: true });
      if (roomFx && !reduce) roomFx.blast(targets, move, colors);
      return;
    }
    a.fx = a.fx || window.ptbMoves.create(a.el.querySelector(".fxs"));
    a.fx.play(move, { body: a.el.querySelector(".bd"), dir: 1, force: true });
    // 쏘는 자리는 몸 앞쪽, 맞는 자리는 보스 몸통(그림 상자의 왼쪽 가운데쯤)
    if (roomFx && !reduce) roomFx.attack(roomPt(a.el.querySelector("img"), 0.7, 0.5), roomPt($("bsBossImg"), move.damageClass === "physical" ? 0.34 : 0.42, 0.6), move, colors);
  }
  const AIL = { paralysis: "마비", burn: "화상", poison: "독", sleep: "잠듦", freeze: "얼음", confusion: "혼란" };

  /** 판을 차린다 — 아이들을 바닥에 고르게(앞줄부터). 뒤에 내보낸 내 아이는 내 자리(0번)에 선다 */
  function setupScene(r) {
    clearInterval(idleTimer);
    for (const a of actors.values()) a.el.remove();
    actors.clear();
    $("bsLog").innerHTML = "";
    const n = r.allies.length;
    sizeActors(n);
    const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.6)));
    const rows = Math.ceil(n / cols);
    const homes = r.allies.map((_, i) => {
      const c = i % cols;
      const rw = Math.floor(i / cols);
      return [6 + (c + (rw % 2) * 0.5) * (46 / cols), 78 + (rows > 1 ? (rw / (rows - 1)) * 17 : 8)];
    });
    const B = r.boss;
    const scene = { team: [], homes, B, bossNow: B.hp, toMilli: (hp) => Math.round((hp / B.bar) * 1000) };
    r.allies.forEach((f, i) => enter(scene, f, i));
    bossHp(scene.toMilli(B.hp));
    return scene;
  }

  /** 아이 하나를 판에 세운다 */
  function enter(scene, f, i) {
    if (scene.team[i]) return scene.team[i];
    const a = { el: actorEl("p:" + i, f.url, `${f.me ? "나" : f.owner} · ${f.name}`, f.me), hp: f.maxHp, max: f.maxHp };
    actors.set("p:" + i, a); // 끝나면 같이 치운다
    a.home = scene.homes[i] || scene.homes[0]; // 뒤에 나온 내 아이는 내 자리에
    put(a, ...a.home);
    scene.team[i] = a;
    return a;
  }

  /**
   * 한 토막을 재생한다. 아이들은 바닥에 흩어져 서 있다가 차례가 오면 보스에게 달려들고 돌아온다.
   * 보스의 기술은 모두에게 한꺼번에 간다. 사건이 많으면(서른 마리면 수백 개) 30초 안팎이 되게 빨리 돈다.
   */
  async function playSeg(scene, r) {
    const { team, toMilli } = scene;
    const k = Math.max(0.08, Math.min(1, 30000 / 500 / Math.max(1, r.log.length))); // 사건이 60개를 넘으면 그만큼 빨리
    const wait = (ms) => sleep(ms * k);
    let bossTurn = false;

    for (const ev of r.log) {
      if (ev.t === "enter") {
        const a = enter(scene, r.allies[ev.who], ev.who);
        if (!fast) { a.el.classList.add("act"); setTimeout(() => a.el.classList.remove("act"), 600); }
        logLine(ev.text, "mv");
        await wait(700);
        continue;
      }
      const a = typeof ev.who === "number" ? team[ev.who] : null;
      if (ev.t === "turn") {
        bossTurn = false;
        logLine(ev.text, "turn");
        if (!fast) for (const x of team) if (x && x.hp > 0 && Math.random() < 0.5) put(x, x.home[0] + rand(-3, 3), x.home[1] + rand(-3, 3));
        await wait(250);
      } else if (ev.t === "move") {
        logLine(ev.text, "mv");
        if (ev.who === "b") {
          bossTurn = true;
          skill(null, ev.move, team.filter((x) => x && x.hp > 0 && !x.el.classList.contains("gone")).map((x) => roomPt(x.el.querySelector("img"))));
          // 공격 기술이면 기를 모은 뒤 방 전체로 퍼진다 — 모두가 맞는다
          if (!fast && ev.move.damageClass !== "status") setTimeout(() => { $("bsWave").classList.remove("go"); void $("bsWave").offsetWidth; $("bsWave").classList.add("go"); }, 450);
          await wait(1000);
        } else if (a) {
          bossTurn = false;
          a.el.classList.add("act");
          // 물리 기술은 보스 앞까지 달려가 들이받고, 특수 · 변화 기술은 제자리에서 쓴다
          const near = ev.move.damageClass === "physical";
          if (near) put(a, rand(55, 60), rand(82, 94));
          setTimeout(() => skill(a, ev.move), fast || !near ? 0 : 300);
          await wait(near ? 750 : 600);
          setTimeout(() => { a.el.classList.remove("act"); if (a.hp > 0) put(a, ...a.home); }, fast ? 0 : 1100 * k);
        }
      } else if (ev.t === "hp") {
        if (ev.who === "b") {
          if (ev.hp < scene.bossNow) { blink($("bsBoss")); pop(rand(70, 84), rand(40, 56), `-${bars(toMilli(scene.bossNow - ev.hp))}칸`, "dmg"); }
          scene.bossNow = ev.hp;
          bossHp(toMilli(ev.hp));
          if (ev.text) logLine(ev.text);
          await wait(260);
        } else if (a) {
          if (ev.hp < a.hp) blink(a.el);
          a.hp = ev.hp;
          const q = ev.hp / ev.max;
          const bar = a.el.querySelector(".hp i");
          bar.style.width = Math.max(0, q * 100) + "%";
          bar.className = q <= 0.2 ? "red" : q <= 0.5 ? "yellow" : "";
          if (ev.text) logLine(ev.text);
          await wait(bossTurn ? 90 : 220); // 보스가 모두를 때리면 한꺼번에 줄어드는 게 보이게
        }
      } else if (ev.t === "faint") {
        // 쓰러진 내 아이는 자리를 비운다 — 다음 아이가 그 자리에 선다
        if (a) { a.el.classList.add("down"); a.el.classList.remove("act"); put(a, ...a.home); if (r.allies[ev.who] && r.allies[ev.who].me) setTimeout(() => a.el.classList.add("gone"), fast ? 0 : 800); }
        logLine(ev.text, "ft");
        await wait(ev.who === "b" ? 1000 : 260);
      } else {
        if (a && ev.status !== undefined) a.el.querySelector(".st").textContent = ev.status && ev.status !== "unconfused" ? AIL[ev.status] || "" : "";
        if (a && ev.transform) a.el.querySelector("img").src = $("bsBossImg").src;
        logLine(ev.text, ev.who == null ? "sys" : ev.eff > 1 ? "good" : ev.eff < 1 ? "bad" : "");
        await wait(ev.who == null ? 300 : 160);
      }
    }
    if (r.need) logLine(`내 포켓몬이 쓰러졌다! 다음 포켓몬을 골라 주세요 (${r.used.length} / ${r.limit}마리 나감)`, "rw");
  }

  /** 끝 — 이번 판에 누가 얼마나(주인마다) */
  async function summary(r) {
    const by = new Map();
    for (const f of r.allies) by.set(f.me ? "나" : f.owner, (by.get(f.me ? "나" : f.owner) || 0) + f.dealt);
    const best = [...by].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (best.length) logLine("깎은 칸 — " + best.map(([n, v]) => `${n} ${bars(v)}`).join(" · "), "sys");
    const x = r.raid;
    if (!x) return;
    logLine(x.dealt > 0 ? `🐉 길드원과 함께 레이드 보스에게 ${bars(x.dealt)}칸을 깎았다! (내 몫 ${bars(x.mine)}칸 · 내 포켓몬 ${r.used.length}마리)` : "🐉 레이드 보스를 깎지 못했다…", "rw");
    if (x.cleared) { logLine(`🎉 ${x.cleared}단계 보스를 쓰러뜨렸다! 이 단계에 깎은 길드원 모두에게 조각이 갑니다`, "rw"); toast(`🎉 ${x.cleared}단계 보스를 쓰러뜨렸습니다!`, "shiny"); }
    if (x.again) logLine("끝내지 못한 도전을 이어서 했습니다(같은 결투) — 도전 횟수는 늘지 않았습니다.", "sys");
    logLine(`오늘 남은 도전 ${x.triesLeft}번`, "sys");
    fast = false;
    await sleep(1500);
  }

  $("bsGo").onclick = () => challenge();
  $("bsSkip").onclick = () => (fast = true); // 결과는 이미 정해져 있다. 남은 장면을 건너뛸 뿐이다
  $("bsRefresh").onclick = () => { shards = null; load(); };

  /** 한 번 더 눌러야 실행 — 되돌릴 수 없는 버튼 */
  function sure(btn, label) {
    if (btn.dataset.sure === "1") return true;
    btn.dataset.sure = "1";
    const was = btn.textContent;
    btn.textContent = label;
    setTimeout(() => {
      if (!btn.isConnected) return;
      btn.dataset.sure = "";
      btn.textContent = was;
    }, 3000);
    return false;
  }
  const done = (r) => {
    if (!r || !r.ok) toast((r && r.reason) || "하지 못했습니다", "bad");
    else if (r.message) toast(r.message);
    return r && r.ok;
  };
  $("bsShards").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.redeem) {
      if (!sure(b, "정말 받기?")) return;
      b.disabled = true;
      const r = await window.ptb.raidRedeem(Number(b.dataset.redeem));
      if (r && r.ok) toast(r.message, r.shiny ? "shiny" : "");
      else done(r);
    } else if (b.hasAttribute("data-swap")) {
      const from = Number($("bsFrom").value);
      const to = Number($("bsTo").value);
      if (from === to) return toast("다른 전설을 골라 주세요", "bad");
      if (!sure(b, "정말?")) return;
      b.disabled = true;
      done(await window.ptb.raidSwap({ from, to }));
    } else return;
    shards = null;
    loadShards();
  });

  window.ptb.onStats((s) => {
    const was = last;
    last = s;
    if ($("tab-boss").hidden || playing) return;
    // 길드에 들어가거나 나왔으면 다시 받는다. 박스가 바뀌었으면 선반만 다시
    const key = (x) => (x && x.guild && !x.guild.gone ? x.guild.code : "") + (x && x.online && x.online.enabled ? "1" : "0");
    const boxKey = (x) => ((x && x.box) || []).map((m) => m.id + ":" + (m.profile ? m.profile.level : 0)).join(",");
    if (!was || key(was) !== key(s)) load();
    else if (view && !drag && boxKey(was) !== boxKey(s)) { renderPick(); renderShelf(); }
  });

  window.ptbBoss = { open: () => load() };
})();
