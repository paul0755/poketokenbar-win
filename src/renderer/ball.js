"use strict";
/**
 * 몬스터볼 창.
 *
 * 펫 드래그와 같은 방식이다 — 창을 직접 끌지 않고 화면 좌표만 메인에 보낸다.
 * 메인이 창을 커서에 붙여 옮기고, 놓는 순간의 속도로 날린다. 날아가는 길과
 * 맞았는지 판정도 메인이 한다(야생 창의 자리를 아는 쪽이 메인이다).
 */
const ball = document.getElementById("ball");
let dragging = false;
let moved = 0; // 누른 뒤 움직인 거리. 거의 없으면 던진 게 아니라 누른 것 — 볼 종류를 바꾼다
let from = null;
let locked = false; // 날아가는 중·포획 판정 중에는 잡을 수 없다

document.body.classList.add("idle");

window.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || locked) return;
  dragging = true;
  moved = 0;
  from = { x: e.screenX, y: e.screenY };
  document.body.classList.add("dragging");
  document.body.classList.remove("idle");
  window.ptb.ballDragStart({ x: e.screenX, y: e.screenY });
});

window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  moved = Math.max(moved, Math.abs(e.screenX - from.x) + Math.abs(e.screenY - from.y));
  window.ptb.ballDrag({ x: e.screenX, y: e.screenY });
});

window.addEventListener("mouseup", (e) => {
  if (!dragging) return;
  dragging = false;
  document.body.classList.remove("dragging");
  if (moved <= 4) {
    document.body.classList.add("idle");
    return window.ptb.ballClick();
  }
  window.ptb.ballDragEnd({ x: e.screenX, y: e.screenY });
});

function replay(cls) {
  ball.classList.remove("shake", "open");
  void ball.offsetWidth;
  if (cls) ball.classList.add(cls);
}

window.ptb.onBall((d) => {
  const b = document.body.classList;
  switch (d.t) {
    case "set":
      // 볼 종류에 따라 위쪽 색이 바뀐다 — 몬스터볼 빨강, 슈퍼볼 파랑, 하이퍼볼 검정·노랑
      document.body.dataset.ball = d.key;
      document.getElementById("n").textContent = "×" + d.n;
      document.getElementById("odds").textContent = Math.round(d.p * 100) + "%";
      document.body.title = `${d.name} — 끌어서 던지기 · 누르면 볼 바꾸기`;
      break;
    case "fly":
      locked = true;
      b.remove("idle");
      b.add("fly");
      break;
    case "land": // 빗나가서 돌아왔다 — 다시 잡을 수 있다
      locked = false;
      b.remove("fly", "busy");
      b.add("idle");
      ball.classList.remove("caught");
      break;
    case "hit":
      b.remove("fly");
      b.add("busy");
      break;
    case "shake":
      replay("shake");
      break;
    case "open":
      replay("open");
      break;
    case "caught":
      ball.classList.add("caught");
      replay(null);
      document.getElementById("star").classList.add("on");
      break;
  }
});
