"use strict";
/**
 * 💎 메가진화 컷인 — 디지털 월드 필살기 컷인(digibattle.js drawCut)과 같은 꼴.
 *
 *   비스듬한 띠가 열린다 → 메가진화하는 쪽에서 원래 모습(도트)이 미끄러져 들어온다
 *   → 키스톤 빛이 깜빡이며 두 모습이 번갈아 보이다가 하얗게 터지고 3D 메가 모습이 된다
 *   → 반대쪽에서 "메가진화" · 메가 이름이 들어온다 → 띠가 닫힌다
 *
 * 그리는 곳(host)은 overflow: hidden 인 장면 — 결투 무대(#arena) · 레이드 방(#bsRoom).
 * 타이밍은 전부 CSS 애니메이션(megacut.css). 여기서는 판을 깔고, 끝나면 치운다.
 *
 *   await window.ptbMegaCut.play(host, { from, to, name, stone, side })
 *     from — 원래 모습 그림(도트 앞모습)   to — 메가 모습 그림(3D 앞모습)
 *     side — 0 이면 왼쪽(내 쪽)에서, 1 이면 오른쪽(상대)에서 들어온다
 */
(function () {
  const DUR = 2300; // megacut.css 의 --d 와 같다
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  /** 그림을 미리 받아 둔다 — 띠가 열린 뒤에 그림이 늦게 뜨면 빈 띠만 지나간다 */
  const load = (src) =>
    new Promise((res) => {
      if (!src) return res();
      const im = new Image();
      im.onload = im.onerror = () => res();
      im.src = src;
      setTimeout(res, 1500);
    });

  async function play(host, o = {}) {
    if (!host || !o.to) return;
    await Promise.all([load(o.from), load(o.to)]);
    host.querySelectorAll(".mc-cut").forEach((x) => x.remove());
    const el = document.createElement("div");
    el.className = "mc-cut" + (o.side === 1 ? " right" : "");
    el.style.setProperty("--d", DUR + "ms");
    el.innerHTML = `
      <div class="mc-band"><i class="mc-ln"></i>
        <div class="mc-pic">
          <i class="mc-orb"></i>
          ${o.from ? `<img class="a" src="${esc(o.from)}" alt="">` : ""}
          <img class="b${o.from ? "" : " only"}" src="${esc(o.to)}" alt="">
        </div>
        <div class="mc-nm"><small>${esc(o.stone ? o.stone + " ✦ 메가진화" : "메가진화")}</small><b>${esc(o.name || "")}</b></div>
      </div>
      <i class="mc-flash"></i>`;
    host.appendChild(el);
    await new Promise((res) => setTimeout(res, DUR));
    el.remove();
  }

  window.ptbMegaCut = { play, DUR };
})();
