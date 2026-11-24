"use strict";
const $ = (id) => document.getElementById(id);

const fmt = (n) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + "B"
  : n >= 1e6 ? (n / 1e6).toFixed(1) + "M"
  : n >= 1e3 ? (n / 1e3).toFixed(1) + "K"
  : String(Math.round(n));

/** 남은 시간을 "4일 2시간" / "1시간 10분" 으로 */
function hm(ms) {
  if (ms <= 0) return "곧";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return Math.floor(h / 24) + "일 " + (h % 24) + "시간";
  return h ? h + "시간 " + m + "분" : m + "분";
}

let toastTimer = null;
function toast(msg, kind = "") {
  const el = $("toast");
  el.textContent = msg;
  el.className = "show " + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), 2800);
}

/* ---------------- 탭 ---------------- */

function setTab(name) {
  for (const b of document.querySelectorAll("nav button[data-tab]")) {
    b.classList.toggle("on", b.dataset.tab === name);
  }
  for (const id of ["home", "shop", "box", "room", "boss", "battle", "dex", "news", "report", "world", "jogress", "field"]) $("tab-" + id).hidden = id !== name;
  document.querySelector(".scroll").scrollTop = 0;
  // 열 때 최신 값을 받아온다. 상점·도감은 홈과 갱신 주기가 다르다.
  if (name === "shop") {
    window.ptb.requestShop();
    if (window.ptbMall) window.ptbMall.open(); // 코인 지갑 · 상점에 팔기 · 길드 몰
  }
  if (name === "dex") window.ptb.requestDex();
  if (name === "news" && window.ptbNews) window.ptbNews.open(); // 📢 새 소식 — 열면 읽은 것으로
  if (name === "field" && window.ptbField) window.ptbField.open(); // ⚔️ 필드 배틀 — 판 크기를 다시 잰다
  if (name === "jogress" && window.ptbJogress) window.ptbJogress.open(); // 🧬 조그레스 — 열 때마다 박스를 다시 본다
  if (name === "report" && window.ptbReport) window.ptbReport.open(); // 📊 주간 리포트
  if (name === "boss" && window.ptbBoss) window.ptbBoss.open(); // 길드 레이드 — 열 때마다 다시 받는다
  if (name === "battle" && window.ptbGymOpen) window.ptbGymOpen(); // 체육관 · 챔피언 로드 — 주가 바뀌었을 수 있다
  if (name === "room") window.ptb.roomCoins(); // 코인 꾸미기 — 잔액 · 산 목록을 서버에서 다시
}
for (const b of document.querySelectorAll("nav button[data-tab]")) {
  b.onclick = () => setTab(b.dataset.tab);
}
$("openReport").onclick = () => setTab("report"); // 📊 주간 리포트 — 탭 줄에는 없고 홈에서 연다

/** 🗓 출석 — 상점 › 길드 몰의 출석과 같은 것. 온라인을 켰을 때만 보인다(코인 지갑이 서버에 있다) */
function renderCheckin(s) {
  const b = $("homeCheckin");
  b.hidden = !(s.online && s.online.enabled);
  if (b.dataset.busy) return;
  const done = Boolean(s.checkin && s.checkin.done);
  b.disabled = done;
  b.textContent = done ? "🗓 출석 ✓" : "🗓 출석";
  b.title = done ? "오늘 출석 코인을 받았습니다. 내일 다시" : "출석 — 하루 한 번 코인 🪙10";
}
$("homeCheckin").onclick = async () => {
  const b = $("homeCheckin");
  if (b.disabled) return;
  b.disabled = true;
  b.dataset.busy = "1";
  try {
    const r = await window.ptb.walletCheckin();
    toast(r.ok ? r.message : r.reason || "출석하지 못했습니다", r.ok ? "shiny" : "bad");
    if (r.ok) { b.textContent = "🗓 출석 ✓"; return; }
    b.disabled = false;
  } finally {
    delete b.dataset.busy;
  }
};
$("rpClose").onclick = () => setTab("home");

/* ---------------- 홈 ---------------- */

let srcPick = null; // 고른 도구 탭
let pickedDay = null; // 차트에서 고른 날. null이면 오늘
let lastStats = null;

/** 단계에 맞는 한 줄. 숫자만 있으면 키우는 느낌이 안 난다. */
function quipFor(mon, todayTokens) {
  const k = mon.stage.key;
  if (k === "egg") return "곧 부화합니다.";
  if (k === "master") return "더 오를 곳이 없습니다.";
  if (todayTokens > 150e6) return "오늘 일이 몰아칩니다.";
  if (todayTokens < 5e6) return "오늘은 조용하네요.";
  return "쑥쑥 자라는 중입니다.";
}

/** "오후 4시" · "내일 오전 10시" — 버닝타임이 언제 끝나고 언제 오는지 */
function whenLabel(ms) {
  const d = new Date(ms);
  const h = d.getHours();
  const hm = (h < 12 ? "오전 " : "오후 ") + (h % 12 === 0 ? 12 : h % 12) + "시" + (d.getMinutes() ? " " + d.getMinutes() + "분" : "");
  const today = new Date();
  if (h === 0 && !d.getMinutes()) return "자정"; // 늘 24시간 안의 자정이다
  return (d.getDate() === today.getDate() ? "" : "내일 ") + hm;
}

function renderBurn(b) {
  const el = $("monBurn");
  if (!b || !b.enabled || (!b.on && !b.next)) return void (el.hidden = true);
  el.hidden = false;
  el.className = "burn" + (b.on ? " on" : "");
  el.textContent = b.on
    ? `🔥 버닝타임 ×${b.mult}${b.until ? " — " + whenLabel(b.until) + "까지" : ""}`
    : `🔥 다음 버닝타임 ${whenLabel(b.next)}부터 ×${b.mult}`;
}

/**
 * 화폐 — 포켓몬 세계는 🍬 사탕, 디지털 월드는 💠 비트. 메인이 세계와 함께 보낸다(s.world.cur).
 * 방 · 리포트도 이걸 쓴다(window.ptbCur)
 */
const CUR0 = { name: "사탕", icon: "🍬", time: "사탕 타임" };
const cur = () => (lastStats && lastStats.world && lastStats.world.cur) || CUR0;
window.ptbCur = cur;
/** 세계의 말 — "포켓몬" / "디지몬". 받침이 같아(ㄴ) 조사는 그대로 둔다. 화면의 <span class="mw"> 도 이걸로 */
const monWord = () => (lastStats && lastStats.world && lastStats.world.id === "digimon" ? "디지몬" : "포켓몬");
window.ptbMonWord = monWord;

/** 사탕 타임 — 모두 같은 고정 시간(10~16 · 18~24시), 사탕만 ×1.5 */
const sweetLabel = (t) =>
  t.on
    ? `${cur().icon} ${cur().time} ×${t.mult}${t.until ? " — " + whenLabel(t.until) + "까지" : ""}`
    : `${cur().icon} 다음 ${cur().time} ${whenLabel(t.next)}부터 ×${t.mult}`;

function renderSweet(t) {
  const el = $("monSweet");
  if (!t || (!t.on && !t.next)) return void (el.hidden = true);
  el.hidden = false;
  el.className = "burn sweet" + (t.on ? " on" : "");
  el.textContent = sweetLabel(t);
}

function renderHome(s) {
  const { mon, usage } = s;

  // 개체
  $("pic").innerHTML = s.animUrl || s.stillUrl
    ? `<img src="${s.animUrl || s.stillUrl}" alt="">`
    : window.eggSvg(70, mon.single, mon.egg);
  $("monName").textContent = mon.name;

  const b = [];
  if (mon.attr) b.push(`<span class="badge attr a-${mon.attr}">${mon.attr}</span>`); // 🦖 디지몬 속성
  else if (s.rarity && s.rarity.stars) { // 디지몬은 별이 없다(0) — 디지타마 옆에 "디지몬" 배지는 군더더기
    const cls = s.rarity.stars >= 5 ? " r5" : "";
    b.push(`<span class="badge${cls}">${s.rarity.label}</span>`);
  }
  if (s.shiny) b.push('<span class="badge sh">이로치</span>');
  $("monBadge").innerHTML = b.join("");

  $("monStage").textContent = mon.stage.label;
  const p = mon.progress;
  $("monBar").style.width = Math.round(p.ratio * 100) + "%";
  const held = (s.box || []).find((m) => m.id === s.activeId && m.stone);
  $("monGoal").innerHTML = held
    ? held.evolveTo ? `🪨 진화 멈춤 — 돌을 빼면 <b>${held.evolveTo}</b>` : "🪨 변하지않는돌 — 진화 멈춤"
    : p.next ? `${p.next}까지 <b>${fmt(p.remaining)}</b>` : "졸업했습니다";
  $("monQuip").textContent = quipFor(mon, usage.today);
  renderBurn(s.burning);
  renderSweet(s.candy && s.candy.time);

  const t = [];
  // 레벨·타입은 홈에서도 보여야 한다. 박스를 열어야만 보이면
  // 키우는 아이의 상태를 확인하려고 매번 탭을 옮기게 된다.
  const act = (s.box || []).find((m) => m.id === s.activeId);
  const ap = act && act.profile;
  if (!ap && act && act.lv) t.push(`<span class="chip"><b>Lv.${act.lv}</b></span>`); // 🦖 디지몬
  if (ap) {
    t.push(`<span class="chip"><b>Lv.${ap.level}</b></span>`);
    for (let i = 0; i < ap.types.length; i++) {
      t.push(`<span class="ty t-${ap.typeKeys[i]}">${ap.types[i]}</span>`);
    }
  }
  if (s.nature) {
    const n = s.nature;
    t.push(`<span class="chip"><b>${n.name}</b>${n.up ? ` ${n.up}↑ ${n.down}↓` : ""}</span>`);
  }
  if (s.dex) t.push(`<span class="chip">도감 <b>${s.dex.seen}</b>/${s.dex.total}</span>`);
  if (s.dex && s.dex.graduated) t.push(`<span class="chip">졸업 <b>${s.dex.graduated}</b></span>`);
  $("monTraits").innerHTML = t.join("");

  // 진화 트리. 못 간 단계도 숨기지 않는다 —
  // 뭐가 나올지 보이는 게 계속 쓰게 만드는 동기다.
  const tree = s.tree || [];
  $("chain").innerHTML = tree
    .map((n, i) => {
      const cls = ["node", n.reached ? "reached" : "", n.current ? "current" : ""].join(" ");
      // 🦖 디지몬의 앞길은 아직 안 정해졌다(쓰는 대로 갈린다) — 알이 아니라 "?"
      const pic = n.url ? `<img src="${n.url}" alt="">` : n.unknown ? '<div class="unk">?</div>' : window.eggSvg(42);
      const at = n.at === 0 ? "시작" : fmt(n.at);
      return (
        (i ? '<span class="arrow">▸</span>' : "") +
        `<div class="${cls}">${pic}<div class="nm">${n.name}${n.isShiny ? " ★" : ""}</div><div class="at">${at}</div></div>`
      );
    })
    .join("");
  // 다음 단계가 남았으면 그것만 짚어 준다. 표 전체를 다시 설명할 필요는 없다.
  const next = tree.find((n) => !n.reached);
  $("treeNote").textContent = next
    ? next.unknown ? "다음 모습은 쓰는 대로 갈립니다" : "다음 " + next.name
    : tree.length ? "끝까지 왔습니다" : "";

  // 펫 줄
  const purl = s.petAnimUrl || s.petStillUrl;
  $("petThumb").innerHTML = purl ? `<img src="${purl}" alt="">` : window.eggSvg(34, mon.single, mon.egg);
  $("petName").textContent = s.petName || mon.name;
  $("petState").textContent = s.petLine == null ? "키우는 아이를 따라갑니다" : "도감에서 고른 아이";
  const pt = $("petToggle");
  pt.textContent = s.petVisible ? "숨기기" : "띄우기";
  pt.classList.toggle("on", Boolean(s.petVisible));

  // 숫자
  if (s.refreshedAt) {
    const t = new Date(s.refreshedAt);
    $("refreshedAt").textContent =
      "갱신 " + String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0") +
      ":" + String(t.getSeconds()).padStart(2, "0");
  }
  $("today").textContent = fmt(usage.today);
  $("todayRaw").textContent = usage.today.toLocaleString();
  $("week").textContent = fmt(usage.week ?? 0);
  $("month").textContent = fmt(usage.month ?? 0);

  // 이번 달 일별
  const md = usage.monthly || [];
  const peak = Math.max(1, ...md.map((d) => d.n));
  const todayDay = new Date().getDate();
  $("peak").textContent = "최고 " + fmt(peak);
  $("chart").innerHTML = md
    .map(
      (d) =>
        `<span class="b${d.day === todayDay ? " today" : ""}${d.day === pickedDay ? " sel" : ""}" data-day="${d.day}" style="height:${Math.max(2, Math.round((d.n / peak) * 46))}px" title="${d.day}일 ${fmt(d.n)}"></span>`,
    )
    .join("");
  $("axis").innerHTML = md.length
    ? `<span>1</span><span>${Math.round(md.length / 2)}</span><span>${md.length}</span>`
    : "";
  renderDayPick(md, todayDay);

  // 도구 탭
  const srcs = usage.sources || [];
  if (!srcPick || !srcs.some((x) => x.id === srcPick)) srcPick = srcs[0] && srcs[0].id;
  $("srctabs").innerHTML = srcs
    .map((x) => `<button data-src="${x.id}" class="${x.id === srcPick ? "on" : ""}">${x.label}</button>`)
    .join("");
  const cur = srcs.find((x) => x.id === srcPick);
  if (cur) {
    const d = cur.detail;
    $("srcbody").innerHTML =
      `<div class="row1"><span class="k">${cur.label}</span><span class="v">${fmt(cur.total)}</span></div>` +
      (d
        ? `<div class="parts">
             <span>입력 <b>${fmt(d.in)}</b></span>
             <span>출력 <b>${fmt(d.out)}</b></span>
             <span>캐시 쓰기 <b>${fmt(d.cacheW)}</b></span>
             <span>캐시 읽기 <b>${fmt(d.cacheR)}</b></span>
           </div>`
        : "");
  } else {
    $("srcbody").innerHTML = '<div class="note">읽을 로그가 없습니다.</div>';
  }

  renderLimits(s.limits, srcPick, cur && cur.label);
  renderScanWhen();
  renderBox(s);
}

/**
 * 박스 — 보유한 아이들.
 *
 * 세 가지를 한 줄에서 할 수 있어야 한다: 어느 아이가 자라는 중인지 보기,
 * 키우는 아이 바꾸기, 바탕화면에 세우기. 화면을 옮겨 다니게 하면
 * "얘를 띄우려면 어디로 가야 하지"를 매번 생각하게 된다.
 */
let openProfile = null; // 펼쳐 둔 개체 id
// 💿 기술 관리 — 펼쳐 둔 아이와 고르는 중인 기술(저장 전). 박스가 다시 그려져도 고르던 것이 남게 여기 둔다
let moveDraft = null; // { id, ids: Set }
// 💿 기술 관리 목록 정렬 — learn(배운 순) · power(위력 순) · type(타입별). first: 고른 것을 위로. 이 PC 에만 기억한다
let moveSort = { by: "learn", first: false };
try { Object.assign(moveSort, JSON.parse(localStorage.getItem("ptb.moveSort") || "{}")); } catch {}
const saveMoveSort = () => { try { localStorage.setItem("ptb.moveSort", JSON.stringify(moveSort)); } catch {} };
/** 정렬한 목록 — 배운 순은 메인이 준 그대로(레벨업은 배운 레벨 순, 기술머신은 가르친 순) */
function sortPool(pool, picked) {
  const pw = (x) => (x.power || 0) * ((x.accuracy || 100) / 100);
  const by = {
    learn: () => 0,
    power: (a, b) => pw(b) - pw(a) || (a.damageClass === "status") - (b.damageClass === "status"),
    type: (a, b) => String(a.type || "").localeCompare(String(b.type || ""), "ko") || pw(b) - pw(a),
  }[moveSort.by] || (() => 0);
  return pool
    .map((x, i) => ({ x, i }))
    .sort((a, b) => (moveSort.first ? picked.has(b.x.id) - picked.has(a.x.id) : 0) || by(a.x, b.x) || a.i - b.i)
    .map((y) => y.x);
}
/** ✨ 강화 — 재료 고르기를 펼친 아이 { id, mats: [...], pick: 고른 재료 id(아래 확인 줄에서 넣는다) } */
let enhOpen = null;
let forgetAsk = null; // 🗑 한 번 누른 "잊기" — { id, move }. 한 번 더 눌러야 잊는다(놓아주기와 같은 두 번 누르기)

/*
 * 정렬 · 즐겨찾기만 보기. 고른 정렬은 이 PC 에 기억한다 — 못 읽으면 기본(받은 순).
 * 즐겨찾기한 아이는 어느 정렬에서나 위로 모은다. 아끼는 아이를 매번 찾게 하지 않으려는 기능이다
 */
const BOX_LS = "ptb.boxSort";
const boxView = (() => {
  try { return JSON.parse(localStorage.getItem(BOX_LS)) || {}; } catch { return {}; }
})();
const saveBoxView = () => { try { localStorage.setItem(BOX_LS, JSON.stringify(boxView)); } catch {} };
const lvOf = (m) => (m.profile ? m.profile.level : -1); // 알은 맨 뒤
const BOX_SORT = {
  got: () => 0, // 박스 순서 그대로(받은 순)
  new: (a, b) => b._i - a._i,
  lv: (a, b) => lvOf(b) - lvOf(a) || b.grown - a.grown,
  star: (a, b) => b.stars - a.stars || lvOf(b) - lvOf(a),
  grow: (a, b) => b.grown - a.grown,
  name: (a, b) => (a.stageKey === "egg") - (b.stageKey === "egg") || a.name.localeCompare(b.name, "ko"),
  dex: (a, b) => (a.dex || 1e9) - (b.dex || 1e9),
};
$("boxSort").value = BOX_SORT[boxView.sort] ? boxView.sort : "got";
$("boxFavOnly").classList.toggle("on", Boolean(boxView.favOnly));
$("boxSort").addEventListener("change", () => {
  boxView.sort = $("boxSort").value;
  saveBoxView();
  if (lastStats) renderBox(lastStats);
});
$("boxFavOnly").addEventListener("click", () => {
  boxView.favOnly = !boxView.favOnly;
  $("boxFavOnly").classList.toggle("on", boxView.favOnly);
  saveBoxView();
  if (lastStats) renderBox(lastStats);
});

/*
 * ✨ 강화 화면 — 박스 위 "✨ 강화" 버튼. 상세를 하나하나 열어 강화를 찾지 않게, 같은 라인이 둘 이상인 아이만
 * 라인별로 묶어 보여 준다. 묶음마다 중심(강화받을 아이)을 고르고, 나머지가 재료로 바로 펼쳐진다.
 * 중심은 처음엔 강화가 가장 높은 아이 → 키우는 중 → ♥ → 레벨 높은 아이. 고른 것은 화면을 닫을 때까지 기억한다
 */
let enhMode = false;
const enhWho = {}; // 라인 → 중심 아이 id
$("boxEnh").addEventListener("click", () => {
  enhMode = !enhMode;
  enhOpen = null;
  if (lastStats) renderBox(lastStats);
});

/** 재료 후보 — 메인의 enhanceMats 와 같은 규칙(같은 라인 · 나 아님 · ♥ 아님 · 키우는 중 아님 · 결투 중 아님). 넣을 때 메인이 다시 본다 */
function localMats(t, rows) {
  return rows.filter((x) => x.line === t.line && x.id !== t.id && !x.fav && !x.active && !x.inDuel).map((x) => ({
    id: x.id, name: x.name, stage: x.stage, shiny: x.shiny, graduated: x.graduated,
    level: x.profile ? x.profile.level : x.lv, ability: x.profile ? x.profile.ability : null, hidden: Boolean(x.profile && x.profile.abilityHidden),
    plus: (x.enh && x.enh.plus) || 0,
    hold: x.stone ? "변하지않는돌" : x.shade ? "빛가림돌" : x.mega && x.mega.id ? x.mega.stone : null,
  }));
}

/** 강화할 수 있는 라인 묶음 — [{ line, mons, target }] */
function enhGroups(rows) {
  const by = new Map();
  for (const m of rows) if (m.enh && m.line != null) by.set(m.line, [...(by.get(m.line) || []), m]);
  const out = [];
  for (const [line, mons] of by) {
    if (mons.length < 2) continue;
    const can = mons.filter((m) => m.enh.plus < m.enh.max && localMats(m, rows).length);
    if (!can.length) continue;
    const rank = (m) => [m.enh.plus, m.active ? 1 : 0, m.fav ? 1 : 0, m.profile ? m.profile.level : 0];
    const best = [...can].sort((a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; })[0];
    const target = can.find((m) => m.id === enhWho[line]) || best;
    out.push({ line, mons, target });
  }
  return out;
}

function renderEnhance(s) {
  const rows = s.box || [];
  const groups = enhGroups(rows);
  if (!groups.length) {
    $("boxList").innerHTML = `<div class="enhlist"><div class="enhtop">강화할 수 있는 아이가 없습니다. 같은 라인의 아이가 둘 이상 있어야 합니다 — 알 · 야생에서 같은 종을 또 데려오면 여기에 나옵니다.<br>♥ 즐겨찾기 · 키우는 중인 아이는 재료가 되지 않습니다.</div></div>`;
    return;
  }
  $("boxList").innerHTML = `<div class="enhlist">
      <div class="enhtop">✨ 같은 라인의 아이를 넣으면 중심 아이가 강화됩니다(+1 ~ +5). 넣은 아이는 박스에서 떠납니다.<br>위에서 <b>중심</b>을 고르고, 아래에서 <b>재료</b>를 고르세요.</div>
      ${groups.map(({ line, mons, target }) => {
        const who = mons.filter((m) => m.enh.plus < m.enh.max || m.id === target.id).map((m) => `<button class="${m.id === target.id ? "on" : ""}" data-enhwho="${m.id}" data-line="${line}">${m.url ? `<img src="${m.url}" alt="">` : ""}${m.profile ? "Lv." + m.profile.level : m.stage}${m.enh.plus ? ` <em>+${m.enh.plus}</em>` : ""}${m.active ? " · 키우는 중" : ""}${m.fav ? " ♥" : ""}</button>`).join("");
        return `<div class="enhgrp">
          <div class="gh"><b>${target.name}</b><span>같은 라인 ${mons.length}마리</span></div>
          <div class="who"><span class="lab">중심</span>${who}</div>
          ${enhanceHtml(target, target.profile, localMats(target, rows))}
        </div>`;
      }).join("")}
    </div>`;
}

function renderBox(s) {
  const all = s.box || [];
  // ✨ 강화 버튼 — 강화할 수 있는 라인 수. 디지털 월드(enh 없음)엔 없다
  const eg = all.some((m) => m.enh) ? enhGroups(all).length : -1;
  $("boxEnh").hidden = eg < 0;
  $("boxEnh").classList.toggle("on", enhMode);
  $("boxEnh").innerHTML = enhMode ? "← 박스로" : `✨ 강화${eg > 0 ? ` <b>${eg}</b>` : ""}`;
  $("tab-box").classList.toggle("enhon", enhMode && eg >= 0); // 정렬 · 즐겨찾기 줄은 강화 화면에서 숨긴다
  if (enhMode && eg >= 0) {
    $("boxCount").textContent = all.length + "마리";
    return renderEnhance(s);
  }
  const favN = all.filter((m) => m.fav).length;
  $("boxCount").textContent = all.length + "마리";
  $("boxFavN").textContent = favN ? `♥ ${favN}마리` : "";
  const cmp = BOX_SORT[$("boxSort").value] || BOX_SORT.got;
  const list = all
    .map((m, i) => ({ ...m, _i: i }))
    .filter((m) => !boxView.favOnly || m.fav)
    .sort((a, b) => b.fav - a.fav || cmp(a, b) || a._i - b._i);
  // 이미 다 떠 있으면 모두 띄우기, 숨겨 두었으면 모두 내리기는 누를 게 없다.
  // 아무도 안 골랐어도 키우는 아이는 떠 있으니(petTargets) 내리기는 "보이는가"로만 정한다
  $("petAllOn").disabled = !list.length || (s.petVisible !== false && list.every((m) => m.isPet));
  $("petAllOff").disabled = s.petVisible === false;
  if (!list.length)
    return void ($("boxList").innerHTML = `<div class="note">${
      boxView.favOnly && all.length ? "즐겨찾기한 아이가 없습니다. 그림 왼쪽 위의 ♥ 를 누르면 즐겨찾기합니다." : "아직 없습니다."
    }</div>`);

  $("boxList").innerHTML = list
    .map((m) => {
      const tags =
        (m.active ? '<span class="tag">키우는 중</span>' : "") +
        (m.isPet ? '<span class="tag pet">바탕화면</span>' : "") +
        (m.graduated ? '<span class="tag gr">졸업</span>' : "") +
        (m.boost > 0 ? '<span class="tag bo">2배</span>' : "") +
        (m.enh && m.enh.plus ? `<span class="tag pl${m.enh.plus >= m.enh.max ? " mx" : ""}" title="✨ 강화 +${m.enh.plus}">+${m.enh.plus}</span>` : "") +
        (m.stone ? '<span class="tag st" title="변하지않는돌을 지니고 있다">🪨</span>' : "") +
        (m.shade ? '<span class="tag st" title="빛가림돌을 지니고 있다 — 졸업해도 원래 색">🌑</span>' : "") +
        (m.profile && m.profile.moveNew ? `<span class="tag mvn" title="새로 배운 기술 ${m.profile.moveNew}개 — 상세 › 💿 기술 관리에서 넣는다">💿NEW</span>` : "") +
        (m.mega && m.mega.id ? `<span class="tag st" title="${eul(m.mega.stone)} 지니고 있다${m.mega.perm ? " — 마스터라 늘 " + m.mega.form : m.mega.ready ? " — 결투에서 " + m.mega.form + "(으)로 메가진화" : ""}">💎</span>` : "");
      // 돌을 지녔으면 "진화까지 1" 이 영영 안 줄어든다 — 멈춰 있다고 말한다
      const goal = m.stone
        ? m.evolveTo ? `진화 멈춤 — 돌을 빼면 ${m.evolveTo}` : "변하지않는돌 — 진화 멈춤"
        : m.next ? `${m.next}까지 ${fmt(m.remaining)}` : "다 자랐습니다";
      const p = m.profile;
      const lv = p ? `Lv.${p.level} · ` : m.lv ? `Lv.${m.lv} · ` : ""; // 🦖 디지몬은 프로필 없이 레벨만
      return `
        <div class="bx ${m.active ? "act" : ""} ${m.fav ? "fv" : ""}" data-id="${m.id}">
          <div class="pic"><button class="fav ${m.fav ? "on" : ""}" data-fav="${m.id}" title="${m.fav ? "즐겨찾기 풀기" : "즐겨찾기 — 위쪽에 모으고, 놓아주기 · 팔기를 막습니다"}">${m.fav ? "♥" : "♡"}</button>${m.mega && m.mega.perm && m.mega.petUrl ? `<img class="mega" src="${m.mega.petUrl}" alt="">` : m.url ? `<img src="${m.url}" alt="">` : window.eggSvg(50, m.single, m.egg)}</div>
          <div class="info" title="눌러서 상세 보기">
            <div class="nm">${m.name}${m.shiny ? " ★" : ""}${tags}</div>
            <div class="sub">${lv}${m.stars ? "★".repeat(m.stars) + " " : ""}${m.stage}${m.nature ? " · " + m.nature : ""}</div>
            <div class="sub">${goal}</div>
            <div class="track"><i style="width:${Math.round((m.ratio || 0) * 100)}%"></i></div>
          </div>
          <div class="acts">
            <button data-act="active" ${m.active ? "disabled" : ""}>${m.active ? "키우는 중" : "키우기"}</button>
            <button data-act="pet" class="${m.isPet ? "on" : ""}">${m.isPet ? "내리기" : "띄우기"}</button>
            <button data-act="release" class="del" ${m.fav ? 'disabled title="즐겨찾기한 아이는 놓아줄 수 없습니다"' : ""}>놓아주기</button>
          </div>
        </div>
        ${openProfile === m.id ? profileHtml(p, m, s.berries, s.stones, s.shades) : ""}`;
    })
    .join("");
}

/** 을/를 — 💎 메가스톤 이름(…나이트를 · 유성의 조각을) */
const eul = (w) => {
  const c = String(w).charCodeAt(String(w).length - 1);
  return w + (c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? "을" : "를");
};

/**
 * ✨ 강화 · 💊 특성캡슐 — 상세의 특성 바로 아래 카드 하나.
 *
 * 문장만 늘어놓으면 "몇 단계에서 무엇이 되나"가 안 읽힌다 — 다섯 칸 단계표로 보여 주고, 다음 칸만 빛낸다.
 * 재료는 그림 칸으로 고르고(같은 라인이라 이름만으론 구분이 안 된다 — Lv · 특성을 같이), 고르면 아래 확인 줄에서
 * "누구를 넣으면 무엇이 되나"를 한 문장으로 보여 준 뒤 넣는다. 캡슐은 따로 — 바뀔 후보 이름을 늘 보여 준다.
 */
const ENH_STEPS = [
  ["🎲", "특성 랜덤"],
  ["💪", "개체값 31"],
  ["🔓", "숨김 열림"],
  ["💪", "개체값 31"],
  ["⭐", "전부 31"],
];
function enhanceHtml(m, p, inline = null) {
  const e = m.enh;
  if (!e) return "";
  const done = e.plus >= e.max;
  const steps = ENH_STEPS.map(([ic, lab], i) => {
    const st = i < e.plus ? "on" : i === e.plus ? "nx" : "";
    return `<li class="${st}"><i>${i < e.plus ? "✓" : ic}</i><b>+${i + 1}</b><span>${lab}</span></li>`;
  }).join("");

  // 재료 고르기 — 박스 목록에서 그림을 찾아 붙인다
  // inline — ✨ 강화 화면: 재료가 늘 펼쳐져 있다(목록은 화면이 만든다)
  const open = Boolean(inline) || (enhOpen && enhOpen.id === m.id);
  const pickId = enhOpen && enhOpen.id === m.id ? enhOpen.pick : null;
  const matList = inline || (enhOpen && enhOpen.mats) || [];
  let picker = "";
  if (open) {
    const rows = (lastStats && lastStats.box) || [];
    const cards = matList.map((x) => {
      const r = rows.find((b) => b.id === x.id) || {};
      const img = r.url ? `<img src="${r.url}" alt="">` : window.eggSvg ? window.eggSvg(30, r.single, r.egg) : "🥚";
      return `<button class="mc${pickId === x.id ? " sel" : ""}" data-enhpick="${x.id}" data-id="${m.id}">
          <span class="im">${img}</span>
          <b>${x.name}${x.shiny ? " ★" : ""}</b>
          <small>${x.level ? "Lv." + x.level : x.stage}${x.plus ? " · +" + x.plus : ""}</small>
          <small class="ab">${x.ability ? x.ability + (x.hidden ? " (숨김)" : "") : "—"}</small>
        </button>`;
    }).join("");
    const sel = matList.find((x) => x.id === pickId);
    const confirm = sel
      ? `<div class="enhgo">
          <div><b>${sel.name}</b>${sel.level ? ` (Lv.${sel.level})` : ""}을(를) 넣으면 <b>+${e.plus + 1}</b> — ${e.next}.
            <small>넣은 아이는 박스에서 떠납니다${sel.graduated ? " · 졸업 기록은 남습니다" : ""}${sel.hold ? ` · ${sel.hold}은(는) 가방으로` : ""}</small></div>
          <span class="bt"><button class="go" data-enhgo="${m.id}">넣고 강화</button><button data-enhcancel="1">취소</button></span>
        </div>`
      : '<div class="enhhint">재료로 넣을 아이를 고르세요.</div>';
    picker = `<div class="enhpick">${cards}</div>${confirm}`;
  }

  // 💊 캡슐 — 후보를 늘 보여 준다
  const curAb = p && p.ability ? `${p.ability}${p.abilityHidden ? " (숨김)" : ""}` : "—";
  const cand = e.capPool.map((c) => `<b>${c.name}${c.hidden ? " (숨김)" : ""}</b>`).join(" · ");
  const capLine = e.capPool.length
    ? `${curAb} → ${cand}${e.capPool.length > 1 ? " 중 하나" : ""}`
    : `바꿀 좋은 특성이 없습니다${e.lockedHidden.length ? ` — 강화 +3 이면 <b>${e.lockedHidden.join(" · ")}</b>(숨김)도 후보` : ""}`;
  const capBtn = !e.caps ? `<span class="none">상점에서 ${e.capPrice != null ? cur().icon + e.capPrice : "살 수 있다"}</span>` : `<button data-cap="${m.id}"${e.capOk ? "" : " disabled"}>쓰기</button>`;

  return `<div class="enhcard">
      <div class="eh"><b>✨ 강화</b><span class="lvl">+${e.plus}<small> / ${e.max}</small></span></div>
      <ol class="steps">${steps}</ol>
      ${done
        ? '<div class="enhnext done">최대 강화입니다.</div>'
        : `<div class="enhnext">다음 <b>+${e.plus + 1}</b> — ${e.next}</div>
           ${inline ? "" : e.mats
             ? `<button class="enhbtn${open ? " on" : ""}" data-enh="${m.id}">${open ? "재료 고르기 닫기" : `✨ 재료 넣고 강화하기 <small>같은 라인 ${e.mats}마리</small>`}</button>`
             : '<div class="enhhint">같은 라인의 아이를 더 데려오면(알 · 야생) 재료로 넣을 수 있습니다. ♥ 즐겨찾기 · 키우는 중인 아이는 재료가 되지 않습니다.</div>'}`}
      ${picker}
      <div class="capcard">
        <div class="ct"><b>💊 특성캡슐</b><span>${e.caps}개</span>${capBtn}</div>
        <div class="cl">${capLine}</div>
        <div class="cs">결투에서 효과가 있는 좋은 특성 중 하나로 랜덤 · 숨겨진 특성은 강화 +3 부터</div>
      </div>
    </div>`;
}

/**
 * 개체 상세.
 *
 * 능력치는 숫자만 나열하면 어느 게 높은지 훑어지지 않는다. 막대로 그리되
 * 기준을 255로 둔다 — 원작 종족값 상한이라 종끼리 비교가 된다.
 * 개체값은 따로 적는다. 능력치가 낮은 게 레벨 탓인지 개체 탓인지
 * 구분이 안 되면 "개체값"을 보여주는 의미가 없다.
 */
function profileHtml(p, m = {}, bag = [], stones = 0, shades = 0) {
  if (!p) return '<div class="prof"><div class="meta">이 종의 상세 정보가 없습니다.</div></div>';

  const types = (p.typeKeys || [])
    .map((k, i) => `<span class="ty t-${k}">${p.types[i]}</span>`)
    .join("");

  const stats = p.stats
    .map(
      (s) => `
      <div class="stat">
        <span class="k">${s.name}</span>
        <span class="v">${s.value}</span>
        <span class="bar"><i style="width:${Math.min(100, Math.round((s.base / 255) * 100))}%"></i></span>
        <span class="iv ${s.iv === 31 ? "max" : ""}">${s.iv}/31</span>
      </div>`,
    )
    .join("");

  const mvRow = (m) => `
        <div class="mv">
          <span class="ty t-${m.typeKey || "normal"}">${m.type || "?"}</span>
          <span class="n">${m.name}</span>
          <span class="p">${m.power ? "위력 " + m.power : m.damageClass === "status" ? "변화" : "—"}</span>
        </div>`;
  // 💿 쓰는 기술 — 결투 · 펫이 쓰는 것(p.active). 패시브스킬은 아래에 따로, 늘 쓴다
  const SRC = { level: "레벨", tm: "기술머신" };
  const srcTag = (m) =>
    (m.fresh ? '<span class="src new" title="기술을 고른 뒤에 새로 배웠다">NEW</span>' : "") +
    (SRC[m.src] ? `<span class="src">${m.src === "level" && m.level ? "Lv." + m.level : SRC[m.src]}</span>` : "");
  const mvRow2 = (m) => mvRow(m).replace('<span class="p">', srcTag(m) + '<span class="p">');
  const using = (p.active || p.moves || []).filter((m) => m.src !== "egg");
  const moves = using.length
    ? using.map(mvRow2).join("")
    : '<div class="meta">아직 배운 기술이 없습니다.</div>';
  const pool = p.pool || [];
  const idle = pool.filter((x) => !x.on).length;
  const editing = moveDraft && moveDraft.id === m.id;
  const moveHead = `<h5 class="mvh">기술 — 결투 · 펫이 쓰는 기술 · ${p.moveSet ? "고른 기술" : "자동"}${
    pool.length ? ` <button class="mvedit${editing ? " on" : ""}" data-mvedit="${m.id}">${editing ? "닫기" : "💿 기술 관리"}</button>` : ""}</h5>`;
  const idleNote = !editing && p.moveNew
    ? `<div class="meta">🆕 고른 뒤에 새로 배운 기술 <b>${p.moveNew}개</b> — 쓰는 기술이 넷이라 아직 안 씁니다. 💿 기술 관리에서 바꿔 넣으세요.</div>`
    : !editing && idle ? `<div class="meta">떠올릴 수 있지만 안 쓰는 기술 ${idle}개 — 💿 기술 관리에서 바꿉니다.</div>` : "";
  // 고르기 — 떠올릴 수 있는 기술(지금까지 배운 레벨업 기술 · 기술머신) 가운데 넷까지
  const editor = editing
    ? `<div class="mvpick" data-id="${m.id}">
        <div class="meta">결투 · 펫이 쓸 기술을 <b>${p.moveMax}개까지</b> 고르세요. 패시브스킬은 따로 늘 씁니다. 자동으로 두면 최근에 배운 레벨업 기술 넷과 기술머신을 모두 씁니다.</div>
        <div class="mvsort">${[["learn", "배운 순"], ["power", "위력 순"], ["type", "타입별"]].map(([k, t]) =>
          `<button data-mvsort="${k}" class="${moveSort.by === k ? "on" : ""}">${t}</button>`).join("")}<button data-mvfirst class="${moveSort.first ? "on" : ""}">고른 것 위로</button></div>
        ${sortPool(pool, moveDraft.ids).map((x) => {
          const ask = forgetAsk && forgetAsk.id === m.id && forgetAsk.move === x.id;
          return `<div class="mvrow"><label class="mv pick ${moveDraft.ids.has(x.id) ? "on" : ""}"><input type="checkbox" data-mvpick="${x.id}" ${moveDraft.ids.has(x.id) ? "checked" : ""}>
          <span class="ty t-${x.typeKey || "normal"}">${x.type || "?"}</span><span class="n">${x.name}</span>${srcTag(x)}<span class="p">${x.power ? "위력 " + x.power : x.damageClass === "status" ? "변화" : "—"}</span></label><button class="mvdel${ask ? " ask" : ""}" data-mvforget="${x.id}" title="${
            x.src === "tm" ? "잊기 — 기술머신으로 다시 배울 수 있다" : "잊기 — 아래 되살리기로 돌아온다"}">${ask ? "잊기?" : "잊기"}</button></div>`;
        }).join("")}
        ${(p.forgot || []).length ? `<div class="meta mvgone">🗑 잊은 기술 — ${p.forgot.map((x) => x.name).join(" · ")} <button data-mvrestore="${m.id}">되살리기</button></div>` : ""}
        <div class="feed"><button data-mvsave="${m.id}" ${moveDraft.ids.size ? "" : "disabled"}>고른 ${moveDraft.ids.size}/${p.moveMax}개로 쓰기</button><button data-mvauto="${m.id}">자동으로</button></div>
      </div>`
    : "";
  // 원작의 알기술(eggMoves)이다. 화면에서는 "태어날 때부터 지닌 기술"이라는 뜻으로 패시브스킬이라 부른다
  const eggMoves = (p.eggMoves || []).length ? `<h5>패시브스킬 — 늘 쓴다</h5>${p.eggMoves.map(mvRow).join("")}` : "";
  const tmMoves = "";
  const tmLeft = p.tmLeft ? `<div class="meta">상점의 기술머신으로 ${p.tmLeft}개를 더 가르칠 수 있습니다 — 이 아이에게 어울리는 기술부터 배웁니다.</div>` : "";

  // 나무열매. 좋아하는/싫어하는 맛을 미리 보여 준다 — 원작에서는 몰라서 헤매는 부분이다
  const FL = { spicy: "매운맛", dry: "떫은맛", sweet: "단맛", bitter: "쓴맛", sour: "신맛" };
  const taste = m.likes
    ? `<div class="meta">좋아하는 맛 <b>${FL[m.likes]}</b> · 싫어하는 맛 <b>${FL[m.dislikes]}</b></div>`
    : '<div class="meta">맛을 가리지 않습니다.</div>';
  const have = (bag || []).filter((b) => b.count > 0);
  const feed = have.length
    ? `<div class="feed">${have
        .map((b) => `<button data-feed="${b.key}" data-id="${m.id}">${b.name} ×${b.count}${
          b.flavor === m.likes ? '<span class="lk">좋아함</span>' : b.flavor === m.dislikes ? '<span class="dk">싫어함</span>' : ""
        }</button>`)
        .join("")}</div>`
    : '<div class="meta">가진 나무열매가 없습니다. 결투에서 이기면 받습니다.</div>';
  const boost = m.boost > 0 ? `<div class="boost">토큰 경험치 2배 — ${fmt(m.boost)} 남음</div>` : "";
  const rec = m.record && (m.record.w || m.record.l) ? ` · 전적 ${m.record.w}승 ${m.record.l}패` : "";

  // 지닌 물건 — 변하지않는돌 · 빛가림돌 중 하나
  const canShade = shades > 0 && !m.shiny; // 태어난 이로치는 가릴 수 없다
  const hold = m.stone
    ? `<div class="meta">🪨 <b>변하지않는돌</b>을 지니고 있어 진화하지 않습니다. 토큰은 그대로 쌓입니다.${
        m.evolveTo ? `<br>지금 빼면 바로 <b>${m.evolveTo}</b>(으)로 진화합니다.` : ""
      }</div><div class="feed"><button data-stone="${m.id}">돌 빼기</button></div>`
    : m.shade
      ? `<div class="meta">🌑 <b>빛가림돌</b>을 지니고 있어 졸업해도 이로치로 바뀌지 않습니다. 성장 · 졸업 보상은 그대로입니다.${
          m.stageKey === "master" ? "<br>지금 빼면 이로치로 빛납니다." : ""
        }</div><div class="feed"><button data-stone="${m.id}" data-item="shade">돌 빼기</button></div>`
      : m.mega && m.mega.id
        ? `<div class="meta">💎 <b>${m.mega.stone}</b>${eul(m.mega.stone).slice(m.mega.stone.length)} 지니고 있습니다. ${
            m.mega.perm
              ? `마스터라 늘 <b>${m.mega.form}</b>(으)로 메가진화해 있습니다 — 결투 · 바탕화면 펫 모두. ⚡ 에너지를 쓰지 않습니다.`
              : m.mega.ready
                ? `결투에 나가면 ⚡ 메가 에너지 하나로 <b>${m.mega.form}</b>(으)로 메가진화합니다. 마스터가 되면 늘 메가진화해 있습니다.`
                : `${m.mega.form.replace(/^메가|[XY]$/g, "")}(으)로 진화하면 메가진화할 수 있습니다.`
          }</div><div class="feed"><button data-stone="${m.id}" data-item="${m.mega.id}">돌 빼기</button></div>`
        : stones > 0 || canShade || (m.mega && m.mega.fits.length)
          ? `<div class="feed">${stones > 0 ? `<button data-stone="${m.id}">🪨 변하지않는돌 지니게 하기 (${stones}개)</button>` : ""}${
              canShade ? `<button data-stone="${m.id}" data-item="shade">🌑 빛가림돌 지니게 하기 (${shades}개)</button>` : ""
            }${((m.mega && m.mega.fits) || []).map((x) => `<button data-stone="${m.id}" data-item="${x.id}">💎 ${x.name} 지니게 하기 (${x.n}개)</button>`).join("")}</div>`
          : '<div class="meta">없음. 진화를 멈추려면 변하지않는돌, 졸업해도 원래 색으로 두려면 빛가림돌을 상점에서 사서 지니게 하세요.</div>';

  return `
    <div class="prof">
      <div class="hd">
        <span class="lv">Lv.${p.level}</span>
        ${types}
        <span class="meta">${p.gender}</span>
      </div>
      <div class="abil">
        특성 <b>${p.ability || "—"}</b>${p.abilityHidden ? " (숨겨진 특성)" : ""}
        ${p.abilityDesc ? `<br>${p.abilityDesc}` : ""}
        ${p.ability ? `<br><span class="abb${p.abilityBattle ? "" : " none"}">⚔️ 결투: ${p.abilityBattle || "효과가 없다(교체 · 지닌 물건 · 동료에 쓰는 특성)"}</span>` : ""}
      </div>
      ${enhanceHtml(m, p)}
      <h5>능력치 — 개체값 합계 ${p.ivTotal}/${p.ivMax}</h5>
      ${stats}
      ${moveHead}
      ${moves}
      ${idleNote}
      ${editor}
      ${eggMoves}
      ${tmMoves}
      ${tmLeft}
      <h5>나무열매${rec}</h5>
      ${taste}
      ${feed}
      ${boost}
      <h5>지닌 물건</h5>
      ${hold}
    </div>`;
}

$("boxList").addEventListener("click", async (e) => {
  // 정보 영역을 누르면 상세를 펼친다. 같은 아이를 다시 누르면 접는다.
  const info = e.target.closest(".info");
  if (info) {
    const id = info.closest(".bx").dataset.id;
    openProfile = openProfile === id ? null : id;
    if (lastStats) renderBox(lastStats);
    return;
  }

  const fv = e.target.closest("button[data-fav]");
  if (fv) {
    const r = await window.ptb.boxFav(fv.dataset.fav);
    if (!r || !r.ok) toast((r && r.reason) || "바꾸지 못했습니다", "bad");
    return;
  }

  const fb = e.target.closest("button[data-feed]");
  if (fb) {
    const r = await window.ptb.feedBerry({ id: fb.dataset.id, key: fb.dataset.feed });
    toast(r.ok ? r.message : r.reason, r.ok ? "" : "bad");
    return;
  }

  // 💿 기술 관리
  const me = e.target.closest("button[data-mvedit]");
  if (me) {
    const id = me.dataset.mvedit;
    if (moveDraft && moveDraft.id === id) moveDraft = null;
    else {
      const row = lastStats && (lastStats.box || []).find((x) => x.id === id);
      const p = row && row.profile;
      // 고른 기술이 있으면 그것, 자동이면 지금 쓰는 레벨업 넷부터
      const start = p ? (p.moveSet || (p.moves || []).map((x) => x.id)).slice(0, p.moveMax || 4) : [];
      moveDraft = { id, ids: new Set(start) };
    }
    if (lastStats) renderBox(lastStats);
    return;
  }
  // 정렬
  const so = e.target.closest("button[data-mvsort], button[data-mvfirst]");
  if (so) {
    if (so.dataset.mvsort) moveSort.by = so.dataset.mvsort;
    else moveSort.first = !moveSort.first;
    saveMoveSort();
    if (lastStats) renderBox(lastStats);
    return;
  }
  // 🗑 기술 잊기 — 한 번 누르면 "잊기?", 한 번 더 누르면 잊는다
  const mf = e.target.closest("button[data-mvforget]");
  if (mf && moveDraft) {
    const mid = Number(mf.dataset.mvforget);
    if (!(forgetAsk && forgetAsk.id === moveDraft.id && forgetAsk.move === mid)) {
      forgetAsk = { id: moveDraft.id, move: mid };
      if (lastStats) renderBox(lastStats);
      return;
    }
    forgetAsk = null;
    const r = await window.ptb.forgetMove(moveDraft.id, mid);
    toast(r.ok ? r.message : r.reason, r.ok ? "" : "bad");
    if (r.ok) moveDraft.ids.delete(mid);
    if (lastStats) renderBox(lastStats);
    return;
  }
  const mr = e.target.closest("button[data-mvrestore]");
  if (mr) {
    const r = await window.ptb.restoreMoves(mr.dataset.mvrestore);
    toast(r.ok ? r.message : r.reason, r.ok ? "" : "bad");
    return;
  }
  const mp = e.target.closest("input[data-mvpick]");
  if (mp && moveDraft) {
    forgetAsk = null;
    const mid = Number(mp.dataset.mvpick);
    const row = lastStats && (lastStats.box || []).find((x) => x.id === moveDraft.id);
    const max = (row && row.profile && row.profile.moveMax) || 4;
    if (mp.checked && moveDraft.ids.size >= max) {
      mp.checked = false;
      toast(`기술은 ${max}개까지 고릅니다 — 하나를 먼저 빼 주세요`, "bad");
      return;
    }
    if (mp.checked) moveDraft.ids.add(mid);
    else moveDraft.ids.delete(mid);
    if (lastStats) renderBox(lastStats);
    return;
  }
  const ms = e.target.closest("button[data-mvsave], button[data-mvauto]");
  if (ms) {
    const id = ms.dataset.mvsave || ms.dataset.mvauto;
    const r = await window.ptb.setMoves(id, ms.dataset.mvsave ? [...(moveDraft ? moveDraft.ids : [])] : null);
    toast(r.ok ? r.message : r.reason, r.ok ? "" : "bad");
    if (r.ok) { moveDraft = null; if (lastStats) renderBox(lastStats); }
    return;
  }

  // ✨ 강화 — 재료 목록 펼치기 · 고르기 · 넣기
  const en = e.target.closest("button[data-enh]");
  if (en) {
    const id = en.dataset.enh;
    if (enhOpen && enhOpen.id === id) enhOpen = null;
    else enhOpen = { id, mats: (await window.ptb.enhanceMats(id)) || [], pick: null };
    if (lastStats) renderBox(lastStats);
    return;
  }
  const wh = e.target.closest("button[data-enhwho]");
  if (wh) {
    enhWho[wh.dataset.line] = wh.dataset.enhwho;
    enhOpen = null;
    if (lastStats) renderBox(lastStats);
    return;
  }
  const pk = e.target.closest("button[data-enhpick]");
  if (pk) {
    if (!enhOpen || enhOpen.id !== pk.dataset.id) enhOpen = { id: pk.dataset.id, mats: [], pick: null };
    enhOpen.pick = enhOpen.pick === pk.dataset.enhpick ? null : pk.dataset.enhpick;
    if (lastStats) renderBox(lastStats);
    return;
  }
  if (e.target.closest("button[data-enhcancel]") && enhOpen) {
    enhOpen.pick = null;
    if (lastStats) renderBox(lastStats);
    return;
  }
  const eg = e.target.closest("button[data-enhgo]");
  if (eg && enhOpen && enhOpen.pick) {
    eg.disabled = true;
    const id = eg.dataset.enhgo;
    const mat = enhOpen.pick;
    const r = await window.ptb.enhance(id, mat);
    toast(r.ok ? r.message : r.reason, r.ok ? "" : "bad");
    if (r.ok) {
      // 넣은 아이는 떠났다 — 새 목록이 오기 전에 다시 그려도 그 카드를 다시 누를 수 없게
      if (lastStats && lastStats.box) lastStats.box = lastStats.box.filter((b) => b.id !== mat);
      const left = enhMode ? [] : (await window.ptb.enhanceMats(id)) || [];
      enhOpen = enhMode || r.plus >= 5 || !left.length ? null : { id, mats: left, pick: null };
    }
    if (lastStats) renderBox(lastStats);
    return;
  }
  // 💊 특성캡슐
  const cp = e.target.closest("button[data-cap]");
  if (cp) {
    cp.disabled = true;
    const r = await window.ptb.abCapsule(cp.dataset.cap);
    toast(r.ok ? r.message : r.reason, r.ok ? "" : "bad");
    return;
  }

  const sb = e.target.closest("button[data-stone]");
  if (sb) {
    sb.disabled = true;
    const r = await window.ptb.toggleStone(sb.dataset.stone, sb.dataset.item || "everstone");
    toast(r.ok ? r.message : r.reason, r.ok ? "" : "bad");
    if (!r.ok) sb.disabled = false;
    return;
  }

  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.closest(".bx").dataset.id;
  if (btn.dataset.act === "active") return window.ptb.setActive(id);
  if (btn.dataset.act === "pet") return window.ptb.togglePetMember(id);
  // 놓아주면 되돌릴 수 없다. 한 번 더 누르게 해서 실수로 지우는 걸 막는다.
  if (btn.dataset.act === "release") {
    if (btn.dataset.sure !== "1") {
      btn.dataset.sure = "1";
      btn.textContent = "정말?";
      setTimeout(() => {
        if (!btn.isConnected) return;
        btn.dataset.sure = "";
        btn.textContent = "놓아주기";
      }, 3000);
      return;
    }
    const r = await window.ptb.release(id);
    if (!r.ok) toast(r.reason || "놓아주지 못했습니다");
  }
});

/**
 * 고른 날의 사용량.
 *
 * 호버 툴팁만 있으면 마우스를 떼는 순간 사라져서 다른 날과 비교할 수가 없다.
 * 눌러서 고정하고, 같은 막대를 다시 누르면 오늘로 돌아온다.
 */
function renderDayPick(md, todayDay) {
  const el = $("daypick");
  if (!md.length) return void (el.innerHTML = "");
  const day = pickedDay ?? todayDay;
  const d = md.find((x) => x.day === day);
  if (!d) return void (el.innerHTML = "");

  const rank = [...md].filter((x) => x.n > 0).sort((a, b) => b.n - a.n).findIndex((x) => x.day === day) + 1;
  const used = md.filter((x) => x.n > 0).length;
  const dow = ["일", "월", "화", "수", "목", "금", "토"][new Date(d.key + "T00:00:00").getDay()];

  el.innerHTML =
    `<b>${d.day}일 (${dow})</b>  ${fmt(d.n)}` +
    (d.n ? `  ·  쓴 날 중 ${rank}위 / ${used}일` : "  ·  기록 없음") +
    (pickedDay == null
      ? '  <span class="hint">— 막대를 눌러 다른 날도 볼 수 있습니다</span>'
      : '  <span class="hint">— 다시 누르면 오늘로</span>');
}

$("chart").addEventListener("click", (e) => {
  const b = e.target.closest(".b[data-day]");
  if (!b) return;
  const day = Number(b.dataset.day);
  pickedDay = pickedDay === day ? null : day; // 같은 막대를 다시 누르면 해제
  if (lastStats) renderHome(lastStats);
});

$("srctabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-src]");
  if (!b) return;
  srcPick = b.dataset.src;
  if (lastStats) renderHome(lastStats);
});

/**
 * 한도와 사용 구간.
 *
 * 전에는 셋을 한 목록에 나열했는데("5시간 창 / Codex 주간 / 최근 7일")
 * 뭐가 제약이고 뭐가 그냥 센 값인지 구분이 안 됐다.
 * 제목은 "한도"인데 실제 한도가 있는 건 Codex 하나뿐이었다.
 *
 * 그래서 둘로 가른다.
 *   공식 한도 — 제공자가 알려준 값이 있는 것만. 퍼센트를 그린다
 *   사용 구간 — 한도를 알 수 없는 것. 쓴 양과 속도만 보여준다
 *
 * 5시간 블록은 Claude Code가 한도를 재는 단위지만 그 한도값이 로컬에
 * 없다. 퍼센트를 지어내는 대신 "이 블록에서 이만큼 썼다"만 말한다.
 */
/**
 * 쿼터 값이 얼마나 묵었는지.
 *
 * opencodex가 캐시를 갱신할 때만 값이 바뀐다. 갱신이 멈추면 우리 숫자는
 * 틀린 게 아니라 오래된 것인데, 화면에서는 구분되지 않는다.
 * 실제로 Codex가 32%일 때 앱이 37%를 보여준 적이 있다 — 4시간 45분 묵은 값이었다.
 */
/**
 * 값이 얼마나 묵었는지.
 *
 * 제공자 값은 그쪽이 새로 알려줄 때만 바뀐다. 갱신이 멈추면 우리 숫자는
 * 틀린 게 아니라 오래된 것인데, 화면에서는 구분되지 않는다.
 * 실제로 Codex가 32%일 때 4시간 45분 묵은 37%를 최신처럼 보여준 적이 있다.
 */
/** 시:분 — 로그에 적힌 리셋 시각처럼 "언제" 가 중요한 값에 쓴다 */
function hhmm(ms) {
  return new Date(ms).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
}

function age(ms, stale) {
  if (typeof ms !== "number") return "";
  const m = Math.round(ms / 60000);
  if (m < 2) return "방금 값";
  const when = m < 60 ? m + "분 전" : hm(ms) + " 전";
  return stale ? `⚠️ ${when} 값` : `${when} 값`;
}

function quotaAge(q) {
  if (typeof q.ageMs !== "number") return "";
  const m = Math.round(q.ageMs / 60000);
  if (m < 2) return "방금 갱신된 값";
  const when = m < 60 ? m + "분 전" : hm(q.ageMs) + " 전";
  return q.stale ? `⚠️ ${when} 값 — 그 뒤 사용분은 미반영` : `${when} 갱신`;
}

const tone = (left) => (left <= 15 ? "hot" : left <= 35 ? "warn" : "");

/** 남은 비율을 아는 줄 */
function limitRow(title, sub, leftPct, extra) {
  const t = tone(leftPct);
  return `
    <div class="limrow">
      <div class="top">
        <span class="k">${title}</span>
        <span class="t">${sub}</span>
        <span class="p ${t}">${leftPct}% 남음</span>
      </div>
      <div class="track"><i class="${t}" style="width:${leftPct}%"></i></div>
      ${extra ? `<div class="note">${extra}</div>` : ""}
    </div>`;
}

/** 한도를 모를 때 — 쓴 양만 */
function usageRow(title, sub, value, extra) {
  return `
    <div class="limrow">
      <div class="top">
        <span class="k">${title}</span>
        <span class="t">${sub}</span>
        <span class="p plain">${value}</span>
      </div>
      ${extra ? `<div class="note">${extra}</div>` : ""}
    </div>`;
}

/**
 * 고른 도구의 5시간 블록과 주간.
 *
 * 전에는 전체 합산 한 덩어리로 보여줬는데, 도구마다 한도가 따로라
 * "이게 어느 도구 한도인지" 알 수가 없었다. 도구 탭을 따라간다.
 *
 * 퍼센트는 한도를 아는 경우에만 그린다 —
 *   Codex 주간은 제공자가 알려준 값,
 *   나머지는 설정에 직접 적어 넣은 값.
 * 둘 다 없으면 쓴 양만 보여준다. 모르는 값으로 %를 만들지 않는다.
 */
function renderLimits(L, srcId, srcLabel) {
  const el = $("spans");
  if (!L) return void (el.innerHTML = "");
  $("limSrc").textContent = srcLabel || "";

  const p = (L.perSource || {})[srcId];
  if (!p) return void (el.innerHTML = '<div class="note">이 도구의 기록이 없습니다.</div>');

  const rows = [];

  // 한도가 어디서 왔는지는 막대 밑에 한 줄로만 밝힌다
  // 공식값은 15분마다 쓰이므로 최대 그만큼 뒤처진다. 나이를 밝혀 둔다.
  /**
   * 출처 꼬리표. 창마다 따로 붙인다.
   *
   * 공식값이면 나이까지 적는다. 분모(토큰)는 **직접 넣은 한도로 막대를
   * 그렸을 때만** 적는다 — 공식 퍼센트로 그린 막대 옆에 옛 수동 한도를
   * 적어두면 두 숫자가 서로 다른 말을 한다.
   */
  const tag = (from) =>
    !from ? "" : from === "공식 값" && p.officialAgeMs != null ? from + " " + age(p.officialAgeMs, false) : from;

  /* ── 5시간 블록 ── */
  const bSub = p.block ? `${hm(p.block.remainingMs)} 뒤 새 블록` : "";
  if (p.blockLeftPct != null) {
    const amount = !p.block
      ? ""
      : p.blockFrom === "직접 넣은 값"
        ? `${fmt(p.block.used)} / ${fmt(p.blockLimit)} · 시간당 ${fmt(p.block.perHour)}`
        : `${fmt(p.block.used)} 사용 · 시간당 ${fmt(p.block.perHour)}`;
    rows.push(limitRow("5시간", bSub, p.blockLeftPct, [amount, tag(p.blockFrom)].filter(Boolean).join(" · ")));
  } else if (p.block) {
    /*
     * 공식값이 있었는데 쓸 수 없는 경우와, 아예 없는 경우는 다른 상황이다.
     * 뭉뚱그려 "한도를 알면 막대가 나옵니다" 라고만 하면, 공식값을 읽고
     * 있는데도 막대가 없는 사람은 영문을 모른다.
     */
    const st = p.officialBlockStale;
    rows.push(usageRow("5시간", bSub, fmt(p.block.used),
      !st
        ? `시간당 ${fmt(p.block.perHour)} · ${p.block.count}건 — 한도를 알면 막대가 나옵니다`
        : p.officialBlockResetAt
          ? `공식값은 ${st.block}% 사용이지만 ${hhmm(p.officialBlockResetAt)}에 창이 리셋됐습니다 —
             끝난 창의 값이라 쓰지 않습니다.`
          : `공식값은 ${age(st.ageMs, false)}(${st.block}% 사용) — 그 뒤 ${fmt(st.drift)}을 더 써서
             지금 몇 %인지는 알 수 없습니다.`));
  } else {
    rows.push(usageRow("5시간", "", "쉬는 중", "5시간 넘게 요청이 없었습니다"));
  }

  /* ── 주간 ── */
  // 리셋 시각을 알면 그 창으로 센다. 모르면 롤링 7일인데,
  // 둘은 다른 값이므로 제목에서 어느 쪽인지 밝힌다.
  const wTitle = p.weekAnchored ? "주간" : "주간 (최근 7일)";
  const wSub = p.weekResetAt ? `${hm(p.weekResetAt - L.now)} 후 리셋` : "";
  if (p.weekLeftPct != null) {
    const amount =
      p.weekFrom === "직접 넣은 값" ? `${fmt(p.week)} / ${fmt(p.weekLimit)}` : `${fmt(p.week)} 사용`;
    rows.push(limitRow(wTitle, wSub, p.weekLeftPct, [amount, tag(p.weekFrom)].filter(Boolean).join(" · ")));
  } else {
    // 공식값이 있었는데 묵어서 막대를 못 그린 경우는 그 사실을 밝힌다
    const st = p.officialStale;
    rows.push(usageRow(wTitle, wSub, fmt(p.week),
      st
        ? `공식값이 ${age(st.ageMs, true)} — 지금 몇 %인지는 알 수 없습니다`
        : "설정 › 한도 맞추기에서 지금 몇 %인지 넣으면 막대가 나옵니다"));
  }

  /*
   * "방금 읽음" 과 "공식 값 4시간 전" 이 나란히 놓이면 서로 모순돼 보인다.
   * 둘은 다른 것을 가리킨다 — 하나는 우리가 파일을 읽은 시각이고,
   * 다른 하나는 그 파일에 적힌 값의 나이다. 새로고침은 파일을 다시 읽을 뿐,
   * 도구가 제 사용률을 새로 쓰게 만들 수는 없다. 그 말을 여기서 한다.
   */
  if (p.officialAgeMs != null && p.officialAgeMs > 30 * 60 * 1000) {
    rows.push(
      `<div class="note">공식 사용률은 ${srcLabel || "도구"}가 파일에 쓸 때 바뀝니다 —
        새로고침해도 ${hm(p.officialAgeMs)} 전 값 그대로입니다.</div>`,
    );
  }

  el.innerHTML = rows.join("");
}

/* ---------------- 상점 ---------------- */

window.ptb.onShop((s) => {
  $("walletLab").textContent = "쓸 수 있는 " + cur().name;
  $("wallet").textContent = cur().icon + " " + s.candy.left;
  $("walletSub").innerHTML =
    `${fmt(s.candy.per)} 쓸 때마다 1개 · 다음까지 <b>${fmt(s.candy.toNext)}</b><br>` +
    (s.candy.time ? `${sweetLabel(s.candy.time)} (매일 10~16 · 18~24시)<br>` : "") +
    `졸업하면 5개 추가 (받은 것 ${s.candy.earned} · 쓴 것 ${s.candy.spent})`;

  $("items").innerHTML = s.items
    .map((it) => {
      const dis = it.owned || !it.afford ? " disabled" : "";
      return `<div class="item">
          <div class="ic">${it.ball && window.ptbBall ? window.ptbBall.svg(it.ball) : it.egg && window.ptbEgg ? window.ptbEgg.svg(it.egg, 34) : it.capsule && window.ptbEgg ? window.ptbEgg.capsule(34) : it.icon}</div>
          <div class="body">
            <div class="nm">${it.name}</div>
            <div class="de">${it.desc}</div>
            ${it.legend ? legendBar(it.legend) : ""}
            <div class="pr">가격 ${cur().icon}${it.cost}${it.have != null ? ` · 가진 수 ${it.have}` : ""}</div>
          </div>
          <button data-id="${it.id}"${dis}>${it.owned ? (it.weekly ? "이번 주 ✓" : "보유") : "구매"}</button>
        </div>`;
    })
    .join("") + megaShop(s);
});

/** 🏆 전설의 알 — 모은 전설 수. 다 모으면 그때부터는 적게 가진 전설부터 나온다 */
function legendBar(l) {
  const done = l.have >= l.total;
  return `<div class="lgd${done ? " done" : ""}">
      <span>🏆 모은 전설 <b>${l.have}</b>/${l.total}</span>
      <i><em style="width:${Math.round((l.have / l.total) * 100)}%"></em></i>
      <small>${done ? "다 모았다 — 이제 적게 가진 전설부터" : `아직 없는 ${l.total - l.have}마리 중에서 나온다`}</small>
    </div>`;
}

/** 💎 메가스톤 — 박스에 있는 라인의 것만 메인이 보낸다 */
function megaShop(s) {
  if (!s.mega) return "";
  const m = s.mega;
  const head = `<div class="item-hd">💎 메가스톤 <span>⚡ 메가 에너지 ${m.energy}/${m.max} — 토큰 ${fmt(m.per)}마다 하나 · 메가진화 한 번에 하나 · 마스터는 에너지 없이 늘 메가${m.on ? "" : " · <b>지금 메가진화 꺼짐</b>(배틀 탭)"}</span></div>`;
  if (!(s.stones || []).length) return head + '<div class="note">박스에 메가진화하는 포켓몬의 라인이 없습니다. 리자몽 · 갸라도스 · 망나뇽처럼 메가진화하는 아이를 데려오면 그 메가스톤이 여기에 나옵니다.</div>';
  return head + s.stones.map((it) => `<div class="item">
      <div class="ic">💎</div>
      <div class="body">
        <div class="nm">${it.name} <small>→ ${it.mega}</small></div>
        <div class="de">${it.desc}</div>
        <div class="pr">가격 ${cur().icon}${it.cost} · 가진 수 ${it.have}${it.held ? ` · 지닌 아이 ${it.held}` : ""}</div>
      </div>
      <button data-id="${it.id}"${it.afford ? "" : " disabled"}>구매</button>
    </div>`).join("");
}

$("items").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-id]");
  if (!btn || btn.disabled) return;
  btn.disabled = true; // 연타로 두 번 사지 않게
  const r = await window.ptb.buy(btn.dataset.id);
  if (!r || !r.ok) {
    toast((r && r.reason) || "구매하지 못했습니다", "bad");
    btn.disabled = false;
    return;
  }
  // 이로치는 1/128이다. 알리지 않으면 나온 줄도 모른다.
  if (r.shiny) toast("✨ 이로치다! " + r.message, "shiny");
  else toast(r.message);
});

/* ---------------- 도감 ---------------- */

let dexEntries = [];
let dexFilter = "all";
const TIER_COLOR = {
  초희귀: "#c084fc", 희귀: "#4a9eff", "보기 드묾": "#4ade80", 보통: "#9aa0ab", 흔함: "#6b6e78",
};

function renderDex() {
  const list =
    dexFilter === "owned" ? dexEntries.filter((e) => e.owned)
    : dexFilter === "got" ? dexEntries.filter((e) => e.seen)
    : dexEntries;

  $("grid").innerHTML = !list.length
    ? '<div class="empty">아직 없습니다</div>'
    : list
        .map((e) => {
          // 전국도감 번호를 그대로 쓴다. 칸 순서가 아니다 —
          // 안 만난 종도 번호는 알려 준다. 빈칸이 어디인지 보여야 모은다.
          const no = `<div class="no">No.${String(e.dexId).padStart(3, "0")}</div>`;
          if (!e.seen) return `<div class="cell locked"><div class="q">?</div>${no}</div>`;
          const cls = ["cell", e.owned ? "owned" : "seenonly", e.isPet ? "pet" : ""].join(" ");
          const tip = `${e.name} · ${e.label} · ${e.stage}\n${
            e.owned ? "이 라인을 보유 중입니다" : "만난 기록입니다. 보유 중이 아닙니다"
          }${e.mega && e.mega.length ? `\n💎 메가진화 — ${e.mega.join(" · ")}` : ""}`;
          return `<div class="${cls}" title="${tip}">
              ${e.isPet ? '<div class="pin">바탕화면</div>' : ""}
              ${e.mega && e.mega.length ? '<div class="mg">💎</div>' : ""}
              ${e.url ? `<img src="${e.url}" alt="">` : '<div class="q">?</div>'}
              <div class="nm">${e.name}</div>
              ${no}
              ${e.graduated ? `<div class="gr">졸업 ${e.graduated}</div>` : ""}
            </div>`;
        })
        .join("");
}

window.ptb.onDex((d) => {
  dexEntries = d.entries;
  const owned = dexEntries.filter((e) => e.owned).length;
  $("dexCount").textContent =
    `${d.seen} / ${d.total} 종 · 보유 ${owned}` + (d.graduated ? ` · 졸업 ${d.graduated}` : "");

  // 등급별로 몇 종을 만났는지. 도감의 진짜 진행도는 이쪽이다.
  const byTier = new Map();
  for (const e of dexEntries) {
    if (!e.seen) continue;
    byTier.set(e.label, (byTier.get(e.label) ?? 0) + 1);
  }
  $("dexTiers").innerHTML = ["초희귀", "희귀", "보기 드묾", "보통", "흔함"]
    .map((k) => `<span><span class="d" style="background:${TIER_COLOR[k]}"></span>${k} ${byTier.get(k) ?? 0}</span>`)
    .join("");

  renderDex();
});

$("grid").addEventListener("click", (e) => {
  if (!e.target.closest(".cell.owned")) return;
  toast("바탕화면에 세우는 것은 박스 탭에서 고릅니다");
});

function setDexFilter(name) {
  dexFilter = name;
  for (const [k, id] of [["all", "fAll"], ["owned", "fOwned"], ["got", "fGot"]]) {
    $(id).classList.toggle("on", dexFilter === k);
  }
  renderDex();
}
$("fAll").onclick = () => setDexFilter("all");
$("fOwned").onclick = () => setDexFilter("owned");
$("fGot").onclick = () => setDexFilter("got");

/* ---------------- 연결 ---------------- */

/** 새 버전 띠 — 받기를 누르면 릴리스 페이지가 열린다. ✕ 는 이 버전만 접는다(트레이 메뉴엔 남는다) */
function renderUpdate(u) {
  const show = Boolean(u && !u.skipped);
  $("upd").hidden = !show;
  if (!show) return;
  $("updVer").textContent = "v" + u.version;
  $("updCur").textContent = "지금 v" + u.current;
}
$("updGo").onclick = () => window.ptb.updateOpen();
$("updSkip").onclick = () => {
  $("upd").hidden = true;
  window.ptb.updateSkip();
};

/* ---------------- 🌏 세계 바꾸기 — 탭 줄의 알약 · 세계 탭 ---------------- */
const WORLD_DESC = {
  pokemon: "포켓몬 614종 · 결투 · 체육관 · 챔피언 로드 · 길드 · 레이드 · 🍬 사탕",
  digimon: "디지몬 151종 · 쓰는 대로 갈리는 진화(Claude 백신 · Codex 데이터 · 밤 바이러스) · 💠 비트",
};
let worldBusy = false;
function renderWorld(w) {
  if (!w) return;
  $("worldIco").textContent = w.icon;
  if (worldBusy) return;
  $("wdCards").innerHTML = w.list
    .map((x) => {
      const tag = x.current ? '<span class="tag">지금 여기</span>' : x.started ? '<span class="tag st">키우는 중</span>' : '<span class="tag new">처음</span>';
      const big = x.id === "digimon" && window.ptbEgg ? window.ptbEgg.digicode(58) : x.icon;
      const btn = x.current
        ? '<button class="go" disabled>여기</button>'
        : `<button class="go" data-world="${x.id}" ${w.locked ? "disabled" : ""}>가기</button>`;
      const more = x.current ? "" : x.started ? "<br>돌아가면 그동안 쓴 만큼 따라잡습니다" : "<br>들어간 날부터 자랍니다";
      return `<div class="wdcard ${x.id}${x.current ? " cur" : ""}">
        <div class="big">${big}</div>
        <div class="bd"><div class="nm">${x.icon} ${x.label} ${tag}</div><div class="de">${WORLD_DESC[x.id] || ""}${more}</div></div>
        ${btn}
      </div>`;
    })
    .join("");
}
$("wdCards").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-world]");
  if (!b || worldBusy) return;
  worldBusy = true;
  b.disabled = true;
  b.textContent = "다시 켭니다…";
  const r = await window.ptb.worldSwitch(b.dataset.world);
  if (!r || !r.ok) {
    worldBusy = false;
    b.disabled = false;
    b.textContent = "가기";
    toast((r && r.reason) || "바꾸지 못했습니다");
  }
});

window.ptb.onStats((s) => {
  lastStats = s;
  renderWorld(s.world);
  // 🌏 세계 — 디지털 월드면 포켓몬 세계에만 있는 탭 · 버튼을 감춘다(index.html 의 body.world-digimon)
  document.body.classList.toggle("world-digimon", Boolean(s.world && s.world.id === "digimon"));
  for (const el of document.querySelectorAll(".mw")) el.textContent = monWord();
  renderUpdate(s.update);
  if (window.ptbNews) window.ptbNews.update(s.news);
  if (window.ptbReport) window.ptbReport.update(s.report);
  renderCheckin(s);
  renderHome(s);
  $("refreshNow").disabled = false;
});

/**
 * 언제 읽은 값인지.
 *
 * 새로고침은 디스크를 다시 읽을 뿐이다. Claude 가 제 사용률을 15분마다
 * 파일에 쓰므로, 눌러도 공식 퍼센트가 그대로일 수 있다. 그때 "고장났나"
 * 싶지 않으려면 무엇이 언제 읽혔는지가 보여야 한다.
 */
function renderScanWhen() {
  const at = lastStats && lastStats.scannedAt;
  if (!at) return void ($("scanWhen").textContent = "");
  const m = Math.round((Date.now() - at) / 60000);
  $("scanWhen").textContent =
    m < 1 ? "방금 다시 읽음" : m < 60 ? m + "분 전에 읽음" : "1시간 넘게 안 읽음";
}

$("refreshNow").onclick = () => {
  $("refreshNow").disabled = true;
  $("scanWhen").textContent = "읽는 중…";
  window.ptb.refreshNow();
};

// 눌러서 읽은 뒤에도 시간은 흐른다. 표시만 따로 갱신한다.
setInterval(renderScanWhen, 30_000);

$("petToggle").onclick = () => window.ptb.togglePet();
for (const [bid, on] of [["petAllOn", true], ["petAllOff", false]]) {
  $(bid).onclick = async () => {
    $(bid).disabled = true; // 연타로 창을 두 번 만들지 않게. 다음 갱신이 다시 정한다
    const r = await window.ptb.petAll(on);
    if (r) toast(r.ok ? r.message : r.reason, r.ok ? "" : "bad");
  };
}
$("gear").onclick = () => window.ptb.openSettings();
$("close").onclick = () => window.ptb.hide();
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.ptb.hide();
});

window.ptb.onGoTab(setTab); // 트레이 메뉴에서 특정 탭으로 열 때

window.ptb.request();
window.ptb.requestShop();
window.ptb.requestDex();
