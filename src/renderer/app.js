"use strict";
const $ = (id) => document.getElementById(id);
const fmt = (n) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + "B"
  : n >= 1e6 ? (n / 1e6).toFixed(1) + "M"
  : n >= 1e3 ? (n / 1e3).toFixed(1) + "K"
  : String(n);

window.ptb.onStats((s) => {
  const { mon, usage } = s;

  $("line").textContent = mon.stage.label;
  $("stage").textContent = mon.name;

  // 알 단계엔 스프라이트가 없다. 부화 전까지는 알을 흔든다.
  const url = s.animUrl || s.stillUrl;
  $("spriteWrap").innerHTML = url
    ? `<img class="sprite" src="${url}" alt="">`
    : `<div class="egg">🥚</div>`;

  const p = mon.progress;
  $("bar").style.width = Math.round(p.ratio * 100) + "%";
  $("next").textContent = p.next
    ? `${p.next}까지 ${fmt(p.remaining)} 남음`
    : "최고 단계에 도달했습니다";

  if (s.dex) $("dex").textContent = "도감 " + s.dex.seen + " / " + s.dex.total;

  // 진화 트리. 아직 못 간 단계는 흑백으로 두되 숨기지는 않는다 —
  // 뭐가 나올지 보이는 게 계속 쓰게 만드는 동기다.
  $("chain").innerHTML = (s.tree || [])
    .map((n, i) => {
      const cls = ["node", n.reached ? "reached" : "", n.current ? "current" : ""].join(" ");
      const pic = n.url ? `<img src="${n.url}" alt="">` : "";
      const at = n.at === 0 ? "시작" : fmt(n.at);
      const node = `<div class="${cls}">${pic}<div class="nm">${n.name}${n.isShiny ? " ★" : ""}</div><div class="at">${at}</div></div>`;
      return (i ? '<span class="arrow">▸</span>' : "") + node;
    })
    .join("");

  $("today").textContent = fmt(usage.today);
  $("total").textContent = fmt(usage.total);

  // 어느 도구에서 얼마나 나왔는지. 합계만 보면 어디서 튀는지 알 수 없다.
  const COLORS = { "Claude Code": "#d97757", Codex: "#5aa9e6" };
  $("srcs").innerHTML = (usage.sources || [])
    .map(([name, n]) => {
      const c = COLORS[name] || "#8a8a96";
      return `<span class="src"><span class="dot" style="background:${c}"></span>${name} <b>${fmt(n)}</b></span>`;
    })
    .join("");

  renderLimits(s.limits);

  const recent = usage.days.slice(-7);
  const max = Math.max(1, ...recent.map(([, t]) => t));
  $("dayList").innerHTML = recent
    .map(([d, t]) => `
      <div class="day">
        <span>${d.slice(5)}</span>
        <span class="track"><i style="width:${Math.round((t / max) * 100)}%"></i></span>
        <span class="n">${fmt(t)}</span>
      </div>`)
    .join("");
});

/** 남은 시간을 "3일 4시간" / "4시간 10분" 으로 */
function hm(ms) {
  if (ms <= 0) return "곧";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return Math.floor(h / 24) + "일 " + (h % 24) + "시간";
  return h ? h + "시간 " + m + "분" : m + "분";
}

/**
 * 한도 표시.
 *
 * 퍼센트는 한도를 아는 곳에서만 그린다. Codex는 opencodex가 캐시한
 * 실제 쿼터가 있지만, 5시간 창은 "얼마가 한도인지"를 알 방법이 없다.
 * 그래서 창은 쓴 양과 남은 시간, 속도만 보여준다 — %를 지어내지 않는다.
 */
function renderLimits(L) {
  const el = $("limits");
  if (!L) return void (el.innerHTML = "");
  const rows = [];

  if (L.block) {
    const b = L.block;
    rows.push(`
      <div class="limrow">
        <div class="top">
          <span class="k">5시간 창</span>
          <span class="v"><b>${fmt(b.used)}</b> · ${hm(b.remainingMs)} 남음</span>
        </div>
        <div class="limnote">시간당 ${fmt(b.perHour)} · ${b.count}건</div>
      </div>`);
  } else {
    rows.push(`
      <div class="limrow">
        <div class="top"><span class="k">5시간 창</span><span class="v">쉬는 중</span></div>
        <div class="limnote">5시간 넘게 요청이 없었습니다</div>
      </div>`);
  }

  if (L.codex) {
    const q = L.codex;
    const hot = q.percent >= 80 ? " hot" : "";
    rows.push(`
      <div class="limrow">
        <div class="top">
          <span class="k">Codex 주간</span>
          <span class="v"><b>${q.percent}%</b> · ${hm(q.resetAt - L.now)} 뒤 리셋</span>
        </div>
        <div class="limbar${hot}"><i style="width:${Math.min(100, q.percent)}%"></i></div>
        ${q.stale ? '<div class="limnote">⚠️ 6시간 넘게 갱신되지 않은 값입니다</div>' : ""}
      </div>`);
  }

  if (L.week) {
    rows.push(`
      <div class="limrow">
        <div class="top">
          <span class="k">최근 7일</span>
          <span class="v"><b>${fmt(L.week.used)}</b></span>
        </div>
      </div>`);
  }

  el.innerHTML = rows.join("");
}

$("refresh").onclick = () => window.ptb.request();
$("swap").onclick = () => window.ptb.nextLine();
$("close").onclick = () => window.ptb.hide();

// Esc로도 닫는다. 포커스가 창 안에 있으면 blur가 안 일어나 자동으로 닫히지 않는다.
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.ptb.hide();
});
const petBtn = $("pet");
if (petBtn) petBtn.onclick = () => window.ptb.togglePet();
$("quit").onclick = () => window.ptb.quit();
window.ptb.request();
