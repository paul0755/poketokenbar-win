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
  for (const id of ["home", "shop", "dex"]) $("tab-" + id).hidden = id !== name;
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
}

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

  /* ── 5시간 블록 ── */
  const bSub = p.block ? `${hm(p.block.remainingMs)} 뒤 새 블록` : "";
  if (p.block && p.blockLeftPct != null) {
    rows.push(limitRow("5시간 블록", bSub, p.blockLeftPct,
      `${fmt(p.block.used)} / ${fmt(p.blockLimit)} · 시간당 ${fmt(p.block.perHour)}`));
  } else if (p.block) {
    rows.push(usageRow("5시간 블록", bSub, fmt(p.block.used),
      `시간당 ${fmt(p.block.perHour)} · ${p.block.count}건 — 한도값을 설정에 넣으면 남은 %가 나옵니다`));
  } else {
    rows.push(usageRow("5시간 블록", "", "쉬는 중", "5시간 넘게 요청이 없었습니다"));
  }

  /* ── 주간 ── */
  const q = srcId === "codex" ? L.codex : null;
  if (q) {
    // 제공자가 알려준 값이 있으면 그게 우선이다
    rows.push(limitRow("주간", `${hm(q.resetAt - L.now)} 후 리셋`, Math.max(0, 100 - q.percent),
      `공식 값 · ${quotaAge(q)}`));
  } else if (p.weekLeftPct != null) {
    rows.push(limitRow("주간 (최근 7일)", "", p.weekLeftPct,
      `${fmt(p.week)} / ${fmt(p.weekLimit)} · 직접 넣은 한도`));
  } else {
    rows.push(usageRow("주간 (최근 7일)", "", fmt(p.week),
      "공식 한도값이 로컬에 없습니다. 설정에 넣으면 남은 %가 나옵니다"));
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
          if (!e.seen) {
            return `<div class="cell locked"><div class="q">?</div><div class="no">No.${e.index + 1}</div></div>`;
          }
          const cls = ["cell", e.owned ? "owned" : "seenonly", e.isPet ? "pet" : ""].join(" ");
          const tip = e.owned
            ? `${e.name} · ${e.label}\n클릭하면 바탕화면 펫이 됩니다`
            : `${e.name} · ${e.label}\n만난 기록입니다. 보유 중이 아닙니다`;
          return `<div class="${cls}"${e.owned ? ` data-line="${e.index}"` : ""} title="${tip}">
              ${e.isPet ? '<div class="pin">바탕화면</div>' : ""}
              ${e.url ? `<img src="${e.url}" alt="">` : '<div class="q">?</div>'}
              <div class="nm">${e.name}</div>
              <div class="no">No.${e.index + 1}</div>
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
  const cell = e.target.closest(".cell[data-line]");
  if (!cell) return;
  window.ptb.setPetLine(Number(cell.dataset.line));
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
});

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
