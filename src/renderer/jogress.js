"use strict";
/**
 * 🧬 조그레스(합체 진화) 탭 — 디지털 월드에만. 메인(index.js jogressList · jogressDo)이 무엇이 되는지 정한다.
 *
 * 밑동(합체할 수 있는 모습인 아이)마다 카드 하나. 카드 안에 될 수 있는 모습마다 한 줄:
 *   [밑동] + [짝 고르기] → [결과(처음이면 실루엣 · ???)]   💠비트  [합체!]
 * 밑동은 이번 단계를 절반 넘게 자랐어야 한다(진화 데이터 막대). 짝은 합쳐져 박스에서 빠진다 — 버튼을 두 번 눌러야 한다.
 * 합치면 두 그림이 가운데로 모여 번쩍이고 결과가 나온다(JOGRESS EVOLUTION).
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const pic = (url, cls = "") => (url ? `<img class="${cls}" src="${esc(url)}" alt="">` : `<span class="jg-noimg ${cls}">?</span>`);
  let data = null;
  const pick = {}; // "밑동id>결과" → 고른 짝 id
  let arm = null; // 한 번 누른 버튼 — 두 번째에 합친다
  let busy = false;

  function render() {
    const box = $("jgList");
    if (!data) return void (box.innerHTML = '<div class="jg-empty">불러오는 중…</div>');
    if (!data.ok) return void (box.innerHTML = `<div class="jg-empty">${esc(data.reason)}</div>`);
    $("jgBits").textContent = `💠 ${data.bits}`;
    if (!data.list.length) {
      box.innerHTML = `<div class="jg-empty">지금 박스에는 합체할 수 있는 모습의 디지몬이 없습니다.<br>
        어떤 디지몬은 다른 디지몬과 합쳐야만 다음 모습이 됩니다 — 키우다 보면 이 탭에 나타납니다.</div>`;
      return;
    }
    box.innerHTML = data.list
      .map(({ base, options }) => {
        const pct = Math.round(Math.min(1, options[0].ratio) * 100);
        const rows = options
          .map((o) => {
            const key = `${base.id}>${o.to}`;
            const usable = o.partners.filter((p) => !p.fav);
            if (!usable.some((p) => p.id === pick[key])) pick[key] = usable[0] ? usable[0].id : null;
            const chips = o.partners.length
              ? o.partners
                  .map((p) => `<button class="jg-chip${pick[key] === p.id ? " on" : ""}" data-pick="${esc(key)}" data-id="${esc(p.id)}" ${p.fav ? 'disabled title="즐겨찾기한 아이는 합체 재료로 쓰지 않습니다"' : ""}>${pic(p.url)}<span>${esc(p.name)}${p.fav ? " ♥" : ""}</span></button>`)
                  .join("")
              : `<span class="jg-need">박스에 짝이 없습니다</span>`;
            const can = o.ready && pick[key] && data.bits >= o.cost;
            const why = !o.ready ? `진화 데이터 ${pct}% — 50% 부터` : !pick[key] ? "짝이 필요합니다" : data.bits < o.cost ? "비트가 모자랍니다" : "";
            const armed = arm === key;
            return `<div class="jg-row">
              <div class="jg-flow">
                <div class="jg-res${o.known ? "" : " unknown"}">${pic(o.url)}<b>${o.known ? esc(o.name) : "???"}</b><small>${esc(o.level)}</small></div>
              </div>
              <div class="jg-side">
                <div class="jg-needline">짝 · <b>${esc(o.need)}</b></div>
                <div class="jg-chips">${chips}</div>
                <div class="jg-act">
                  <button class="jg-go${armed ? " armed" : ""}" data-go="${esc(key)}" ${can ? "" : "disabled"}>${armed ? "정말 합칠까요? 한 번 더" : `🧬 합체 · 💠${o.cost}`}</button>
                  ${why ? `<span class="jg-why">${esc(why)}</span>` : armed ? '<span class="jg-why warn">짝은 합쳐져 박스에서 사라집니다</span>' : ""}
                </div>
              </div>
            </div>`;
          })
          .join("");
        return `<div class="jg-card">
          <div class="jg-base">${pic(base.url)}<div><b>${esc(base.name)}</b><small>${esc(base.stage)}${base.attr ? " · " + esc(base.attr) : ""}${base.active ? " · 키우는 중" : ""}</small>
            <div class="jg-bar" title="이번 단계 진화 데이터"><i style="width:${pct}%"></i></div></div></div>
          ${rows}
        </div>`;
      })
      .join("");
  }

  async function load() {
    data = await window.ptb.jogressList().catch(() => ({ ok: false, reason: "불러오지 못했습니다" }));
    render();
  }

  /** 합체 연출 — 두 그림이 가운데로 모여 번쩍이고, 결과가 나온다 */
  function show(a, b, r) {
    const ov = $("jgFx");
    ov.innerHTML = `<div class="jg-fx-a">${pic(a)}</div><div class="jg-fx-b">${pic(b)}</div><div class="jg-fx-flash"></div>
      <div class="jg-fx-r">${pic(r.url)}<b>${esc(r.name)}</b><small>${esc(r.stage)}</small></div><div class="jg-fx-t">JOGRESS EVOLUTION</div>`;
    ov.hidden = false;
    ov.classList.remove("play");
    void ov.offsetWidth;
    ov.classList.add("play");
    setTimeout(() => (ov.hidden = true), 3600);
  }

  $("jgList").addEventListener("click", async (e) => {
    const chip = e.target.closest("button[data-pick]");
    if (chip) {
      pick[chip.dataset.pick] = chip.dataset.id;
      arm = null;
      return render();
    }
    const go = e.target.closest("button[data-go]");
    if (!go || busy) return;
    const key = go.dataset.go;
    if (arm !== key) {
      arm = key; // 짝이 사라지는 일이라 한 번 더 누르게 한다
      return render();
    }
    arm = null;
    busy = true;
    const [baseId, to] = key.split(">");
    const card = data.list.find((x) => x.base.id === baseId);
    const opt = card && card.options.find((o) => o.to === to);
    const partner = opt && opt.partners.find((p) => p.id === pick[key]);
    const r = await window.ptb.jogress({ baseId, partnerId: pick[key], to });
    busy = false;
    if (r && r.ok) {
      show(card.base.url, partner && partner.url, r.result);
      if (window.toast) window.toast(r.message);
    } else if (window.toast) window.toast((r && r.reason) || "합치지 못했습니다", "err");
    load();
  });

  window.ptbJogress = { open: load };
})();
