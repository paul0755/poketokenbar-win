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
  for (const id of ["home", "shop", "box", "dex"]) $("tab-" + id).hidden = id !== name;
  document.querySelector(".scroll").scrollTop = 0;
  // 열 때 최신 값을 받아온다. 상점·도감은 홈과 갱신 주기가 다르다.
  if (name === "shop") window.ptb.requestShop();
  if (name === "dex") window.ptb.requestDex();
}
for (const b of document.querySelectorAll("nav button[data-tab]")) {
  b.onclick = () => setTab(b.dataset.tab);
}

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

function renderHome(s) {
  const { mon, usage } = s;

  // 개체
  $("pic").innerHTML = s.animUrl || s.stillUrl
    ? `<img src="${s.animUrl || s.stillUrl}" alt="">`
    : window.eggSvg(70);
  $("monName").textContent = mon.name;

  const b = [];
  if (s.rarity) {
    const cls = s.rarity.stars >= 5 ? " r5" : "";
    b.push(`<span class="badge${cls}">${s.rarity.label}</span>`);
  }
  if (s.shiny) b.push('<span class="badge sh">이로치</span>');
  $("monBadge").innerHTML = b.join("");

  $("monStage").textContent = mon.stage.label;
  const p = mon.progress;
  $("monBar").style.width = Math.round(p.ratio * 100) + "%";
  $("monGoal").innerHTML = p.next ? `${p.next}까지 <b>${fmt(p.remaining)}</b>` : "졸업했습니다";
  $("monQuip").textContent = quipFor(mon, usage.today);

  const t = [];
  // 레벨·타입은 홈에서도 보여야 한다. 박스를 열어야만 보이면
  // 키우는 아이의 상태를 확인하려고 매번 탭을 옮기게 된다.
  const act = (s.box || []).find((m) => m.id === s.activeId);
  const ap = act && act.profile;
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
      const pic = n.url ? `<img src="${n.url}" alt="">` : window.eggSvg(42);
      const at = n.at === 0 ? "시작" : fmt(n.at);
      return (
        (i ? '<span class="arrow">▸</span>' : "") +
        `<div class="${cls}">${pic}<div class="nm">${n.name}${n.isShiny ? " ★" : ""}</div><div class="at">${at}</div></div>`
      );
    })
    .join("");
  // 다음 단계가 남았으면 그것만 짚어 준다. 표 전체를 다시 설명할 필요는 없다.
  const next = tree.find((n) => !n.reached);
  $("treeNote").textContent = next ? "다음 " + next.name : tree.length ? "끝까지 왔습니다" : "";

  // 펫 줄
  const purl = s.petAnimUrl || s.petStillUrl;
  $("petThumb").innerHTML = purl ? `<img src="${purl}" alt="">` : window.eggSvg(34);
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

function renderBox(s) {
  const list = s.box || [];
  $("boxCount").textContent = list.length + "마리";
  if (!list.length) return void ($("boxList").innerHTML = '<div class="note">아직 없습니다.</div>');

  $("boxList").innerHTML = list
    .map((m) => {
      const tags =
        (m.active ? '<span class="tag">키우는 중</span>' : "") +
        (m.isPet ? '<span class="tag pet">바탕화면</span>' : "") +
        (m.graduated ? '<span class="tag gr">졸업</span>' : "");
      const goal = m.next ? `${m.next}까지 ${fmt(m.remaining)}` : "다 자랐습니다";
      const p = m.profile;
      const lv = p ? `Lv.${p.level} · ` : "";
      return `
        <div class="bx ${m.active ? "act" : ""}" data-id="${m.id}">
          <div class="pic">${m.url ? `<img src="${m.url}" alt="">` : window.eggSvg(50)}</div>
          <div class="info" title="눌러서 상세 보기">
            <div class="nm">${m.name}${m.shiny ? " ★" : ""}${tags}</div>
            <div class="sub">${lv}${"★".repeat(m.stars)} ${m.stage}${m.nature ? " · " + m.nature : ""}</div>
            <div class="sub">${goal}</div>
            <div class="track"><i style="width:${Math.round((m.ratio || 0) * 100)}%"></i></div>
          </div>
          <div class="acts">
            <button data-act="active" ${m.active ? "disabled" : ""}>${m.active ? "키우는 중" : "키우기"}</button>
            <button data-act="pet" class="${m.isPet ? "on" : ""}">${m.isPet ? "내리기" : "띄우기"}</button>
            <button data-act="release" class="del">놓아주기</button>
          </div>
        </div>
        ${openProfile === m.id ? profileHtml(p) : ""}`;
    })
    .join("");
}

/**
 * 개체 상세.
 *
 * 능력치는 숫자만 나열하면 어느 게 높은지 훑어지지 않는다. 막대로 그리되
 * 기준을 255로 둔다 — 원작 종족값 상한이라 종끼리 비교가 된다.
 * 개체값은 따로 적는다. 능력치가 낮은 게 레벨 탓인지 개체 탓인지
 * 구분이 안 되면 "개체값"을 보여주는 의미가 없다.
 */
function profileHtml(p) {
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
  const moves = p.moves.length
    ? p.moves.map(mvRow).join("")
    : '<div class="meta">아직 배운 기술이 없습니다.</div>';
  // 레벨업 넷과 섞지 않는다. 어디서 배운 기술인지가 원작에서도 중요한 구분이다
  // 원작의 알기술(eggMoves)이다. 화면에서는 "태어날 때부터 지닌 기술"이라는 뜻으로 패시브스킬이라 부른다
  const eggMoves = (p.eggMoves || []).length ? `<h5>패시브스킬</h5>${p.eggMoves.map(mvRow).join("")}` : "";
  const tmMoves = (p.tmMoves || []).length
    ? `<h5>기술머신</h5>${p.tmMoves.map(mvRow).join("")}`
    : "";
  const tmLeft = p.tmLeft ? `<div class="meta">상점의 기술머신으로 ${p.tmLeft}개를 더 가르칠 수 있습니다.</div>` : "";

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
      </div>
      <h5>능력치 — 개체값 합계 ${p.ivTotal}/${p.ivMax}</h5>
      ${stats}
      <h5>기술</h5>
      ${moves}
      ${eggMoves}
      ${tmMoves}
      ${tmLeft}
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
  $("wallet").textContent = "🍬 " + s.candy.left;
  $("walletSub").innerHTML =
    `${fmt(s.candy.per)} 쓸 때마다 1개 · 다음까지 <b>${fmt(s.candy.toNext)}</b><br>` +
    `졸업하면 5개 추가 (받은 것 ${s.candy.earned} · 쓴 것 ${s.candy.spent})`;

  $("items").innerHTML = s.items
    .map((it) => {
      const dis = it.owned || !it.afford ? " disabled" : "";
      return `<div class="item">
          <div class="ic">${it.icon}</div>
          <div class="body">
            <div class="nm">${it.name}</div>
            <div class="de">${it.desc}</div>
            <div class="pr">가격 🍬${it.cost}</div>
          </div>
          <button data-id="${it.id}"${dis}>${it.owned ? "보유" : "구매"}</button>
        </div>`;
    })
    .join("");
});

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
          }`;
          return `<div class="${cls}" title="${tip}">
              ${e.isPet ? '<div class="pin">바탕화면</div>' : ""}
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

window.ptb.onStats((s) => {
  lastStats = s;
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
$("gear").onclick = () => window.ptb.openSettings();
$("close").onclick = () => window.ptb.hide();
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.ptb.hide();
});

window.ptb.onGoTab(setTab); // 트레이 메뉴에서 특정 탭으로 열 때

window.ptb.request();
window.ptb.requestShop();
window.ptb.requestDex();
