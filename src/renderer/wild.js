"use strict";
/**
 * 야생 포켓몬 창. 움직이는 건 메인이 하고, 여기는 장면만 그린다 — 나타남,
 * 볼에 빨려 들어감, 튀어나옴, 도망.
 */
const mon = document.getElementById("mon");
// 내 펫을 끌어다 놓으면 싸운다. 그리는 건 펫 창과 같은 duel.js
window.ptbDuel.attach({ img: mon, body: document.getElementById("body"), flipClass: "right" });

function say(text) {
  const el = document.getElementById("say");
  el.textContent = text;
  el.classList.remove("on");
  void el.offsetWidth;
  el.classList.add("on");
}

function replay(cls) {
  mon.classList.remove("absorb", "out");
  void mon.offsetWidth;
  if (cls) mon.classList.add(cls);
}

window.ptb.onWild((d) => {
  switch (d.t) {
    case "init":
      mon.src = d.url || "";
      document.getElementById("nm").innerHTML =
        d.name + (d.shiny ? " ★" : "") + (d.isNew ? ' <span class="new">NEW</span>' : "");
      break;
    case "face":
      // 원본 스프라이트는 왼쪽을 본다. 오른쪽으로 걸을 때만 뒤집는다
      mon.classList.toggle("right", d.dir > 0);
      break;
    case "absorb":
      replay("absorb");
      document.body.classList.add("inball");
      break;
    case "out":
      replay("out");
      document.body.classList.remove("inball");
      if (d.text) say(d.text);
      break;
    case "say":
      say(d.text);
      break;
    case "gone":
      if (d.text) say(d.text);
      document.body.classList.add("gone");
      break;
  }
});
