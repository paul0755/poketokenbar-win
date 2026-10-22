"use strict";
const img = document.getElementById("pet");
const egg = document.getElementById("egg");
egg.innerHTML = window.eggSvg(100); // 초기값. 설정 크기가 오면 다시 그린다

window.ptb.onStats((s) => {
  // 설정에서 크기를 바꾸면 창은 메인이 줄이고, 그림은 여기서 맞춘다.
  if (s.petSize) {
    const px = Math.round(s.petSize * 0.875);
    // max-*가 아니라 width/height여야 96px 원본이 실제로 커진다.
    img.style.width = px + "px";
    img.style.height = px + "px";
    egg.innerHTML = window.eggSvg(Math.round(s.petSize * 0.78));
    if (!s.mon && !s.facing) return;
  }
  // 배회 중에는 facing만 담은 부분 갱신이 온다. 그때는 이미지를 다시 그리지 않는다.
  if (s.facing) {
    img.classList.toggle("left", s.facing === "left");
    if (!s.mon) return;
  }
  /*
   * 이 창이 맡은 아이를 박스에서 찾는다.
   *
   * 여러 마리가 떠 있으므로 전역 "펫 그림" 하나를 쓰면 전부 같은
   * 모습이 된다. 못 찾으면(막 놓아준 경우) 키우는 개체로 떨어진다.
   */
  const mine = window.ptb.petId && (s.box || []).find((m) => m.id === window.ptb.petId);
  const url = mine
    ? mine.animUrl || mine.url
    : s.petAnimUrl || s.petStillUrl || s.animUrl || s.stillUrl;
  if (url) {
    if (img.getAttribute("src") !== url) img.setAttribute("src", url);
    img.hidden = false;
    egg.hidden = true;
  } else {
    img.hidden = true;
    egg.hidden = false;
  }
  if (s.box) watchMoves(s, mine);
});

/* ---------------- 기술 쓰기 ----------------
   언제 쓰나 — 셋 다 이 창이 받는 갱신만 보고 정한다. 메인에 따로 타이머를 두면
   펫 창을 만들고 없앨 때마다 그쪽 상태도 같이 챙겨야 한다.

     토큰    키우는 아이가 자랐을 때. 토큰을 쓰면 기술을 쓴다 — 이 앱의 이야기 그대로
     새 기술 레벨이 올라 처음 배운 기술. 이건 간격을 따지지 않는다
     심심풀이 가만히 있다가 가끔. 박스에서 꺼내 세워 둔 아이들은 자라지 않으니
              이게 없으면 영영 아무것도 안 한다

   간격은 설정의 "기술 쓰기"를 따른다. "가끔"은 작업 중에 거슬리지 않을 만큼,
   "자주"는 보고 있으면 금방 보일 만큼. 처음엔 자주도 45초·1.5~4분으로 잡았는데
   켜 놓고 지켜봐도 안 쓰는 것처럼 보였다. */

const MOVE_PACE = {
  off: null,
  rare: { gap: 120_000, idle: [4 * 60_000, 8 * 60_000] },
  often: { gap: 20_000, idle: [15_000, 40_000] },
};

const mv = { ready: false, id: null, grown: null, level: null, names: null, lastAt: 0, idleTimer: null, pace: null, moves: [] };

/** 지금 보이는 쪽이 앞이다. 원본 스프라이트는 왼쪽을 본다. */
const facingDir = () => (img.classList.contains("left") ? 1 : -1);

function useMove(move, isNew) {
  if (!move || drag || img.hidden) return; // 끄는 중이거나 아직 알이면 쉰다
  if (window.ptbMoves.play(move, { body: document.getElementById("body"), dir: facingDir(), isNew })) {
    mv.lastAt = Date.now();
    scheduleIdle(); // 방금 썼으니 심심풀이는 처음부터 다시 잰다
  }
}

const randomMove = () => mv.moves[Math.floor(Math.random() * mv.moves.length)];

function scheduleIdle() {
  clearTimeout(mv.idleTimer);
  mv.idleTimer = null;
  if (!mv.pace || !mv.moves.length) return;
  const [a, b] = mv.pace.idle;
  mv.idleTimer = setTimeout(() => useMove(randomMove()), a + Math.random() * (b - a));
}

function watchMoves(s, mine) {
  const pace = MOVE_PACE[s.moveLevel || "rare"] || null;
  const paceChanged = pace !== mv.pace;
  mv.pace = pace;
  // 알은 기술이 없다. 프로필은 알에도 1레벨 기술을 주지만 알이 몸통박치기를 하면 이상하다
  // 쓰는 건 레벨업 넷 + 알기술 + 기술머신으로 가르친 것 전부다
  const pr = mine && mine.stageKey !== "egg" ? mine.profile : null;
  const moves = pr ? [...(pr.moves || []), ...(pr.eggMoves || []), ...(pr.tmMoves || [])] : [];
  mv.moves = moves;
  const names = moves.map((m) => m.name);

  if (!pace || !mine) {
    clearTimeout(mv.idleTimer);
    mv.idleTimer = null;
    mv.id = mine ? mine.id : null;
    mv.grown = mine ? mine.grown : null;
    mv.level = mine && mine.profile ? mine.profile.level : null;
    mv.names = names;
    mv.ready = true;
    return;
  }

  // 다른 아이로 바뀌었으면(놓아주고 키우는 아이로 떨어진 경우 등) 처음부터 센다
  const same = mv.id === mine.id;
  if (paceChanged && mv.ready) {
    // 설정에서 바꾼 순간 한 번 보여 준다. 안 그러면 바꿨는데 뭐가 달라졌는지 알 수가 없다
    useMove(randomMove());
  } else if (same && mv.names) {
    // 진화하면 종이 바뀌어 목록도 바뀐다. 이름만 비교하면 원래 알던 기술이 "새 기술"로 뜬다.
    // 레벨업 기술은 지난번 레벨과 이번 레벨 사이에 배우는 것만, 기술머신은 방금 가르친 것을 새것으로 친다.
    // 알기술은 태어날 때부터 안다 — 업데이트로 처음 채워질 때 "NEW"가 뜨면 거짓말이다
    const learned = moves.find(
      (m) => !mv.names.includes(m.name) && (m.src === "tm" || (mv.level != null && m.level > mv.level)),
    );
    if (learned) useMove(learned, true);
    else if (mine.active && mv.grown != null && mine.grown > mv.grown && Date.now() - mv.lastAt >= pace.gap) {
      useMove(randomMove());
    }
  }
  mv.id = mine.id;
  mv.grown = mine.grown;
  mv.level = mine.profile ? mine.profile.level : null;
  mv.names = names;
  mv.ready = true;
  if (paceChanged || !mv.idleTimer) scheduleIdle();
}

/* ---------------- 끌기 / 누르기 ----------------
   창 전체를 -webkit-app-region: drag 로 두면 클릭 이벤트가 오지 않는다.
   그래서 드래그를 직접 만들고, 거의 안 움직였으면 클릭으로 친다.  */

const CLICK_SLOP = 4; // 이 정도 흔들림은 손떨림이지 드래그가 아니다
let drag = null;

window.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  // 누른 지점만 기억한다. 창 안 어디를 잡았는지는 메인이 알 필요가 없다 —
  // 시작 자리 + 움직인 거리로 계산하므로 잡은 지점은 저절로 상쇄된다.
  drag = { startX: e.screenX, startY: e.screenY, moved: 0 };
  document.body.classList.add("dragging");
  window.ptb.petDragStart();
});

window.addEventListener("mousemove", (e) => {
  if (!drag) return;
  drag.moved = Math.max(
    drag.moved,
    Math.abs(e.screenX - drag.startX) + Math.abs(e.screenY - drag.startY),
  );
  if (drag.moved <= CLICK_SLOP) return; // 아직 클릭일 수 있다
  // 누른 지점에서 얼마나 움직였는지만 보낸다. 창 자리는 메인이 안다.
  window.ptb.petDrag({ dx: e.screenX - drag.startX, dy: e.screenY - drag.startY });
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
