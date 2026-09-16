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

$("refresh").onclick = () => window.ptb.request();
$("swap").onclick = () => window.ptb.nextLine();
const petBtn = $("pet");
if (petBtn) petBtn.onclick = () => window.ptb.togglePet();
$("quit").onclick = () => window.ptb.quit();
window.ptb.request();
