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

/**
 * 애니메이션을 처음부터 다시 건다.
 *
 * 클래스를 뗐다 붙이는 사이에 레이아웃을 한 번 읽어야 브라우저가 "새로 시작"으로 본다.
 * 처음엔 offsetWidth 를 읽었는데, 볼은 SVG 라 offsetWidth 가 없다(undefined) — 그래서
 * 두 번째·세 번째 흔들림이 화면에서 안 움직였다. 판정은 세 번 했는데 보이는 건 한 번이었다.
 * SVG 에도 있는 getBoundingClientRect 를 읽는다.
 */
function replay(cls) {
  ball.classList.remove("shake", "shake2", "open");
  ball.getBoundingClientRect();
  if (cls) ball.classList.add(cls);
}
let shakes = 0;

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
    case "vanish": // 빗나가 바닥에서 튀다가 사라진다
      b.add("vanish");
      break;
    case "land": // 제자리에 다시 나타났다 — 다시 잡을 수 있다
      locked = false;
      b.remove("fly", "busy", "vanish");
      b.add("idle");
      ball.classList.remove("caught");
      break;
    case "hit":
      // 기다릴 때 흔들던 것(idle)이 남아 있으면 포획 흔들림을 덮어쓴다 — 확실히 뗀다
      b.remove("fly", "idle");
      b.add("busy");
      shakes = 0;
      break;
    case "shake":
      // 원작처럼 흔들 때마다 방향을 바꾼다 — 같은 동작이 반복되면 한 번 흔든 것처럼 보인다
      replay(shakes++ % 2 ? "shake2" : "shake");
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
