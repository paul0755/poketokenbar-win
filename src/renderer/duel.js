"use strict";
/**
 * 결투 장면 — 펫 창과 야생 포켓몬 창이 같이 쓴다.
 *
 * 메인(playDuel)이 장면을 하나씩 보낸다. 여기서는 그리기만 한다 —
 * 승패도 순서도 메인이 정해 둔 그대로다.

   창이 펫 크기만 해서 머리 위에 세 줄이 겹쳐 선다:
     맨 위   이름 · 레벨 · 상태이상 + HP 막대
     그 아래 기술 이름 (moves.js 이름표, body.duel 이면 내려온다)
     그 아래 짧은 말 — "효과가 굉장했다!", "공격 ↑"
 *
 * attach({ img, body, flipClass }) — img 는 스프라이트, body 는 몸 연출을 걸 감싼 요소,
 * flipClass 는 그 창에서 "오른쪽을 본다"를 뜻하는 클래스. 펫은 left, 야생은 right 다
 * (원본 스프라이트가 왼쪽을 봐서, 두 창이 같은 일을 서로 다른 이름으로 부른다).
 */
(function () {

function duelHud() {
  let h = document.getElementById("duelHud");
  if (h) return h;
  h = document.createElement("div");
  h.id = "duelHud";
  h.innerHTML = '<div class="nm"><b></b><span class="lv"></span><span class="st"></span></div><div class="bar"><i></i></div>';
  document.body.appendChild(h);
  const say = document.createElement("div");
  say.id = "duelSay";
  document.body.appendChild(say);
  return h;
}

function duelHp(hp, max) {
  const r = Math.max(0, hp / max);
  const bar = duelHud().querySelector(".bar i");
  bar.style.width = r * 100 + "%";
  bar.className = r <= 0.2 ? "red" : r <= 0.5 ? "yellow" : "";
}

function duelSayText(text, kind) {
  const el = document.getElementById("duelSay");
  el.textContent = text;
  el.className = kind || "";
  void el.offsetWidth;
  el.classList.add("on");
}

/** 잠깐 다시 그린다 — 클래스를 뗐다 붙여야 같은 애니메이션이 다시 돈다 */
function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

const AIL_HUD = { paralysis: "마비", burn: "화상", poison: "독", sleep: "잠듦", freeze: "얼음", confusion: "혼란" };

function attach({ img, body, flipClass }) {
  const duel = { on: false, hp: 0 };
  img.classList.add("duel-img");
  body.classList.add("duel-body");
  const facingDir = () => (img.classList.contains(flipClass) ? 1 : -1);

  window.ptb.onDuel((d) => {
    const h = duelHud();
    switch (d.t) {
      case "start":
        duel.on = true;
        duel.hp = d.hp;
        document.body.classList.add("duel");
        body.classList.remove("faint", "cheer");
        h.querySelector("b").textContent = d.name;
        h.querySelector(".lv").textContent = "Lv." + d.level;
        h.querySelector(".st").textContent = "";
        duelHp(d.hp, d.max);
        // 서로 마주 본다. facingDir() 이 이 클래스를 보고 기술을 쏠 방향을 정한다
        img.classList.toggle(flipClass, d.flip);
        break;
      case "move":
        window.ptbMoves.play(d.move, { body, dir: facingDir(), force: true });
        break;
      case "hp":
        if (d.hp < duel.hp) replay(img, "hit");
        duel.hp = d.hp;
        duelHp(d.hp, d.max);
        break;
      case "say":
        duelSayText(d.text, d.kind);
        break;
      case "status":
        h.querySelector(".st").textContent = d.status ? AIL_HUD[d.status] || "" : "";
        break;
      case "faint":
        body.classList.add("faint");
        break;
      case "end":
        if (d.result === "win") {
          duelSayText("승리!", "win");
          replay(body, "cheer");
        } else if (d.result === "draw") {
          duelSayText("무승부", "");
        } else if (d.result === "stay") {
          // 잡으려고 약하게만 만들었다. 깎인 체력 그대로 서 있는다 — HUD 도 남긴다
        } else {
          // 쓰러진 채로 끝내지 않는다. 잠시 뒤 털고 일어난다
          setTimeout(() => body.classList.remove("faint"), 1600);
        }
        break;
      case "clear":
        duel.on = false;
        document.body.classList.remove("duel");
        body.classList.remove("faint", "cheer");
        img.classList.remove("hit");
        break;
    }
  });
  return duel;
}

window.ptbDuel = { attach };
})();
