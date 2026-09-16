"use strict";
const $ = (id) => document.getElementById(id);
const fmt = (n) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + "B"
  : n >= 1e6 ? (n / 1e6).toFixed(1) + "M"
  : n >= 1e3 ? (n / 1e3).toFixed(1) + "K"
  : String(n);

let toastTimer = null;
function toast(msg, kind = "") {
  const el = $("toast");
  el.textContent = msg;
  el.className = "show " + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), 2600);
}

window.ptb.onShop((s) => {
  $("wallet").textContent = "🍬 " + s.candy.left;
  $("earn").innerHTML =
    `사탕은 <b>${fmt(s.candy.per)}</b> 쓸 때마다 1개씩 생깁니다. ` +
    `다음 사탕까지 <b>${fmt(s.candy.toNext)}</b>.<br>` +
    `마스터까지 키워 <b>졸업</b>시키면 5개를 더 받습니다. ` +
    `(지금까지 받은 것 ${s.candy.earned} · 쓴 것 ${s.candy.spent})`;

  $("items").innerHTML = s.items
    .map((it) => {
      const cls = "item" + (it.owned ? " owned" : "");
      const label = it.owned ? "보유" : "🍬 " + it.cost;
      const dis = it.owned || !it.afford ? " disabled" : "";
      return `<div class="${cls}">
          <div class="ic">${it.icon}</div>
          <div class="body">
            <div class="nm">${it.name}</div>
            <div class="de">${it.desc}</div>
          </div>
          <button data-id="${it.id}"${dis}>${label}</button>
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
  // 이로치는 확률이 1/128이다. 그냥 넘어가면 나온 줄도 모른다.
  if (r.shiny) toast("✨ 이로치다! " + r.message, "shiny");
  else toast(r.message);
});

$("close").onclick = () => window.ptb.closeShop();
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.ptb.closeShop();
});

window.ptb.requestShop();
