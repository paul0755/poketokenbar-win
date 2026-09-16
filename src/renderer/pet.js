"use strict";
const img = document.getElementById("pet");
const egg = document.getElementById("egg");

window.ptb.onStats((s) => {
  // 설정에서 크기를 바꾸면 창은 메인이 줄이고, 그림은 여기서 맞춘다.
  if (s.petSize) {
    const px = Math.round(s.petSize * 0.875);
    img.style.maxWidth = px + "px";
    img.style.maxHeight = px + "px";
    egg.style.fontSize = Math.round(s.petSize * 0.56) + "px";
    if (!s.mon && !s.facing) return;
  }
  // 배회 중에는 facing만 담은 부분 갱신이 온다. 그때는 이미지를 다시 그리지 않는다.
  if (s.facing) {
    img.classList.toggle("left", s.facing === "left");
    if (!s.mon) return;
  }
  const url = s.animUrl || s.stillUrl;
  if (url) {
    if (img.getAttribute("src") !== url) img.setAttribute("src", url);
    img.hidden = false;
    egg.hidden = true;
  } else {
    img.hidden = true;
    egg.hidden = false;
  }
});

/* ---------------- 끌기 / 누르기 ----------------
   창 전체를 -webkit-app-region: drag 로 두면 클릭 이벤트가 오지 않는다.
   그래서 드래그를 직접 만들고, 거의 안 움직였으면 클릭으로 친다.  */

const CLICK_SLOP = 4; // 이 정도 흔들림은 손떨림이지 드래그가 아니다
let drag = null;

window.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  drag = {
    // 창 안에서 어디를 잡았는지. 이걸 빼야 커서가 그 지점을 계속 물고 간다.
    grabX: e.clientX,
    grabY: e.clientY,
    startX: e.screenX,
    startY: e.screenY,
    moved: 0,
  };
  document.body.classList.add("dragging");
});

window.addEventListener("mousemove", (e) => {
  if (!drag) return;
  drag.moved = Math.max(
    drag.moved,
    Math.abs(e.screenX - drag.startX) + Math.abs(e.screenY - drag.startY),
  );
  if (drag.moved <= CLICK_SLOP) return; // 아직 클릭일 수 있다
  window.ptb.petDrag({ x: e.screenX - drag.grabX, y: e.screenY - drag.grabY });
});

window.addEventListener("mouseup", () => {
  if (!drag) return;
  const wasClick = drag.moved <= CLICK_SLOP;
  drag = null;
  document.body.classList.remove("dragging");
  if (wasClick) window.ptb.petClick();
  else window.ptb.petDragEnd();
});

window.ptb.request();
