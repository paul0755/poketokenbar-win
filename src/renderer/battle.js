"use strict";
/**
 * 결투 탭 — 메인이 끝까지 계산한 사건 목록(main/battle.js)을 차례로 재생한다.
 *
 * 화면은 승패를 정하지 않는다. 재생 속도만 정한다 — "건너뛰기"를 눌러도
 * 결과와 보상은 이미 정해져 있다.
 *
 * 기술 연출은 펫과 같은 moves.js 를 쓴다. 칸(무대)이 둘이라 create() 로 따로 만든다.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const SIDE = ["A", "B"];
  // 왼쪽(A)은 오른쪽을 보고 서야 한다. 원본 스프라이트는 왼쪽을 본다 — 뒤집는다
  const DIR = [1, -1];

  let stages = null;
  let playing = false;
  let fast = false;
  let last = null; // 마지막으로 받은 갱신

  const ensureStages = () =>
    stages || (stages = SIDE.map((k) => window.ptbMoves.create($("stage" + k))));

  const sleep = (ms) => new Promise((r) => setTimeout(r, fast ? 0 : ms));
  const fighters = (s) => (s.box || []).filter((m) => m.stageKey !== "egg" && m.profile);

  /* ---------------- 고르기 ---------------- */

  function fillPick(s) {
    const list = fighters(s);
    for (const [i, k] of SIDE.entries()) {
      const sel = $("btl" + k);
      const keep = sel.value;
      sel.innerHTML = list
        .map((m) => `<option value="${m.id}">${m.name} Lv.${m.profile.level}${m.active ? " (키우는 중)" : ""}</option>`)
        .join("");
      // 고른 게 있으면 지킨다. 처음이면 키우는 아이와 레벨이 가장 비슷한 아이를 붙인다
      if (list.some((m) => m.id === keep)) sel.value = keep;
      else if (i === 0) sel.value = (list.find((m) => m.active) || list[0] || {}).id || "";
      else {
        const a = list.find((m) => m.id === $("btlA").value);
        const rest = list.filter((m) => !a || m.id !== a.id);
        rest.sort((x, y) => Math.abs(x.profile.level - (a ? a.profile.level : 0)) - Math.abs(y.profile.level - (a ? a.profile.level : 0)));
        sel.value = (rest[0] || {}).id || "";
      }
    }
    $("btlGo").disabled = $("btlDesk").disabled = playing || list.length < 2;
    $("btlNote").textContent = list.length < 2 ? "싸울 수 있는 아이가 두 마리 이상 있어야 합니다. 알은 싸우지 않습니다." : "";
  }

  function renderBag(s) {
    const left = s.battleRewardsLeft ?? 0;
    $("btlLeft").textContent = `오늘 보상 ${left}/${s.battleRewardsMax ?? 5}`;
    const bag = s.berries || [];
    $("bag").innerHTML = bag
      .map((b) => `<div class="berry ${b.count ? "" : "none"}"><b>${b.name}</b><span>${b.flavorName}</span><i>×${b.count}</i></div>`)
      .join("");
  }

  window.ptb.onStats((s) => {
    if (!s || !s.box) return;
    last = s;
    if (!playing) fillPick(s);
    renderBag(s);
    renderFriend(s);
    renderTrade(s);
    liveUi();
  });

  /* ---------------- 친선 배틀 ----------------
     내 코드 만들기 → 친구에게 보내기, 친구 코드 붙여 넣기 → 싸우기.
     계산·검사는 메인(friend.js)이 한다. 여기서는 고르고, 보여 주고, 재생한다. */

  function renderFriend(s) {
    const f = s.friend || {};
    const list = fighters(s);
    const sel = $("frMine");
    const keep = sel.value || (f.team && f.team.monId) || (list.find((m) => m.active) || {}).id;
    sel.innerHTML = list.map((m) => `<option value="${m.id}">${m.name} Lv.${m.profile.level}</option>`).join("");
    if (list.some((m) => m.id === keep)) sel.value = keep;
    if (document.activeElement !== $("frName") && !$("frName").value) $("frName").value = f.trainer || "";
    if (f.team) {
      $("frMyBox").hidden = false;
      $("frMyCode").value = f.team.code;
      const who = list.find((m) => m.id === f.team.monId);
      $("frMyNote").textContent = `등록한 팀: ${who ? who.name : "놓아준 아이"} — 이 코드를 친구에게 보내세요. 등록한 뒤 자라도 코드는 그대로입니다.`;
    }
    const r = f.record || {};
    $("frRec").textContent = r.w || r.l || r.d ? `${r.w}승 ${r.l}패${r.d ? " " + r.d + "무" : ""}` : "";
    updateGo();
  }

  let foeOk = false;
  const updateGo = () => ($("frGo").disabled = playing || !foeOk || !(last && last.friend && last.friend.team));

  $("frMake").onclick = async () => {
    const r = await window.ptb.friendRegister({ id: $("frMine").value, trainer: $("frName").value });
    if (!r || !r.ok) return void ($("frMyNote").textContent = (r && r.reason) || "만들지 못했습니다");
    $("frMyBox").hidden = false;
    $("frMyCode").value = r.code;
    $("frMyNote").textContent = "코드를 만들었습니다. 복사해서 친구에게 보내세요.";
  };
  $("frCopy").onclick = async () => {
    const t = $("frMyCode").value;
    try {
      await navigator.clipboard.writeText(t);
    } catch {
      $("frMyCode").select();
      document.execCommand("copy");
    }
    window.toast && toast("코드를 복사했습니다");
  };

  // 붙여 넣으면 바로 누구인지 보여 준다. 잘못 붙였으면 무엇이 틀렸는지 말한다
  let inspectTimer = null;
  $("frTheirs").addEventListener("input", () => {
    clearTimeout(inspectTimer);
    inspectTimer = setTimeout(async () => {
      const code = $("frTheirs").value.trim();
      foeOk = false;
      $("frFoe").hidden = true;
      if (!code) { $("frInfo").textContent = ""; return updateGo(); }
      const r = await window.ptb.friendInspect(code);
      if (!r || !r.ok) {
        $("frInfo").textContent = (r && r.reason) || "읽지 못했습니다";
      } else if (r.self) {
        $("frInfo").textContent = "내 코드입니다. 친구에게 받은 코드를 넣어 주세요.";
      } else {
        foeOk = true;
        $("frFoe").hidden = false;
        $("frFoeImg").src = r.url || "";
        $("frFoeTxt").textContent = `${r.trainer ? r.trainer + "의 " : "친구의 "}${r.name}${r.shiny ? " ★" : ""} (${r.stage})`;
        $("frInfo").textContent = last && last.friend && last.friend.team ? "" : "싸우려면 위에서 내 팀부터 등록해 주세요.";
      }
      updateGo();
    }, 250);
  });

  /* ---------------- 실시간 배틀 ----------------
     중계 서버(server/)로 같은 방에 들어온 두 사람이 같은 결투를 같은 시각에 본다.

       방 만들기(6자리) / 코드로 참가 → 서로의 팀 코드를 받는다 → 둘 다 "준비"
       → 서버가 정한 시각에 동시에 시작

     결투 계산은 친선 배틀과 똑같다(메인 friendBattle — 두 코드로 씨앗과 좌우를 정한다).
     그래서 두 PC가 같은 결투를 계산하고, 서버는 코드와 시작 시각만 전한다.
     서버와 내 시계는 다를 수 있다 — 서버가 매 메시지에 실어 보내는 now 로 차이를 잰다. */

  const live = { ws: null, code: null, role: null, peer: null, offset: 0, result: null };

  function liveOn(s) {
    return Boolean(s && s.online && s.online.enabled);
  }

  function liveState(text, cls = "") {
    $("liveStatus").textContent = text;
    $("liveStatus").className = "note " + cls;
  }

  /**
   * 내 포켓몬 고르기. 처음엔 친선 배틀에 등록한 아이를 몰래 썼는데, 방을 만들 때 누구로
   * 들어가는지 알 수가 없었다. 이 칸에서 직접 고르고, 방 안에서도 바꿀 수 있다.
   */
  function fillLiveMine(s) {
    const sel = $("liveMine");
    const keep = sel.value;
    const list = fighters(s);
    sel.innerHTML = list.map((m) => `<option value="${m.id}">${m.name} Lv.${m.profile.level}${m.active ? " (키우는 중)" : ""}</option>`).join("");
    if (list.some((m) => m.id === keep)) sel.value = keep;
    else sel.value = (list.find((m) => m.active) || list[0] || {}).id || "";
  }

  function liveUi() {
    const s = last;
    const on = liveOn(s);
    const inRoom = Boolean(live.ws);
    if (s) fillLiveMine(s);
    $("liveMine").disabled = !on || playing; // 결투 중에는 못 바꾼다. 방 안에서는 바꿀 수 있다
    $("liveMake").disabled = $("liveJoin").disabled = !on || !$("liveMine").value || inRoom || playing;
    $("liveCodeIn").disabled = !on || inRoom;
    $("liveLeave").hidden = !inRoom;
    $("liveReady").hidden = !(inRoom && live.peer);
    $("liveReady").disabled = playing || !live.peer || !live.peer.ok;
    if (!on) liveState("설정 › 온라인 기능을 켜면 쓸 수 있습니다. 보내는 건 팀 코드와 이름뿐입니다.");
    else if (!inRoom) liveState("내 포켓몬을 고르고, 방을 만들거나 친구에게 받은 6자리 코드로 참가하세요.");
  }

  function liveClose(text) {
    if (live.ws) {
      const ws = live.ws;
      live.ws = null;
      try { ws.close(); } catch {}
    }
    live.peer = null;
    live.code = null;
    $("liveRoom").hidden = true;
    $("liveFoe").hidden = true;
    liveUi();
    if (text) liveState(text);
  }

  async function liveConnect(code, role) {
    const s = last;
    const relay = s.online.relay.replace(/\/+$/, "");
    // 고른 아이로 코드를 만든다. 친선 배틀에 등록한 코드와는 따로다
    const team = await window.ptb.liveTeam($("liveMine").value);
    if (!team || !team.ok) return liveState((team && team.reason) || "포켓몬을 골라 주세요", "bad");
    live.myCode = team.code;
    let ws;
    try {
      ws = new WebSocket(`${relay}/room/${code}?role=${role}`);
    } catch {
      return liveState("서버 주소가 올바르지 않습니다. 설정 › 온라인 기능을 확인해 주세요.", "bad");
    }
    live.ws = ws;
    live.code = code;
    live.role = role;
    live.peer = null;
    liveState("서버에 접속하는 중…");
    liveUi();

    ws.onopen = () => {
      // 내 팀 코드를 보낸다. 친구가 이 코드로 같은 결투를 계산한다
      ws.send(JSON.stringify({ t: "hello", name: (s.friend && s.friend.trainer) || "", team: live.myCode }));
    };
    ws.onmessage = async (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (typeof m.now === "number") live.offset = m.now - Date.now();
      if (m.t === "joined") {
        $("liveRoom").hidden = false;
        $("liveRoomCode").textContent = code;
        liveState(role === "host" ? "방을 만들었습니다. 이 코드를 친구에게 알려 주세요. 기다리는 중…" : "방에 들어왔습니다. 상대를 기다리는 중…");
      } else if (m.t === "peer") {
        // 받은 코드는 메인이 검사한다 — 버전이 다르거나 말이 안 되면 여기서 끝난다
        const r = await window.ptb.friendInspect(m.team);
        live.peer = { team: m.team, name: m.name, ok: Boolean(r && r.ok && !r.self) };
        $("liveFoe").hidden = false;
        if (r && r.ok) {
          $("liveFoeImg").src = r.url || "";
          $("liveFoeTxt").textContent = `${m.name || r.trainer || "상대"}의 ${r.name}${r.shiny ? " ★" : ""} (${r.stage})`;
        } else {
          $("liveFoeImg").src = "";
          $("liveFoeTxt").textContent = "상대 팀을 읽지 못했습니다";
        }
        // 누가 포켓몬을 바꾸면 서버가 양쪽 준비를 내린다 — 내 준비 표시도 내린다
        delete $("liveReady").dataset.on;
        // 내가 방금 바꿔서 서버가 상대 정보를 다시 보낸 거면, 내가 바꿨다는 말을 남긴다
        const mine = live.justChanged;
        live.justChanged = null;
        liveState(
          !live.peer.ok ? (r && r.reason) || "상대 팀을 쓸 수 없습니다"
            : m.changed ? "상대가 포켓몬을 바꿨습니다. 확인하고 다시 준비를 눌러 주세요."
            : mine ? `${mine}(으)로 바꿨습니다. 둘 다 다시 준비를 눌러 주세요.`
            : "상대가 들어왔습니다. 둘 다 준비를 누르면 시작합니다.",
          live.peer.ok ? "" : "bad",
        );
        liveUi();
      } else if (m.t === "peerReady") {
        liveState("상대가 준비했습니다." + ($("liveReady").dataset.on ? " 곧 시작합니다." : " 준비를 누르세요."));
      } else if (m.t === "start") {
        await liveStart(m.at);
      } else if (m.t === "left") {
        live.peer = null;
        $("liveFoe").hidden = true;
        liveState("상대가 나갔습니다. 다른 친구를 기다리거나 방을 나가세요.");
        liveUi();
      } else if (m.t === "error") {
        liveClose(m.reason || "서버가 거절했습니다");
      }
    };
    ws.onclose = () => {
      if (live.ws === ws) liveClose("서버와 연결이 끊겼습니다.");
    };
    ws.onerror = () => {
      if (live.ws === ws) liveClose("서버에 접속하지 못했습니다. 설정 › 온라인 기능의 서버 주소를 확인해 주세요.");
    };
  }

  /** 서버가 정한 시각에 시작한다. 결과는 미리 계산해 두고, 시각이 되면 재생만 한다 */
  async function liveStart(at) {
    if (!live.peer) return;
    playing = true;
    delete $("liveReady").dataset.on;
    liveUi();
    const r = await window.ptb.liveBattle(live.peer.team);
    if (!r || !r.ok) {
      playing = false;
      liveUi();
      return liveState((r && r.reason) || "결투를 시작하지 못했습니다", "bad");
    }
    const localAt = at - live.offset; // 서버 시각 → 내 시계
    $("arena").scrollIntoView({ behavior: "smooth", block: "start" });
    while (Date.now() < localAt) {
      liveState(`${Math.ceil((localAt - Date.now()) / 1000)}초 뒤 시작!`);
      await new Promise((res) => setTimeout(res, Math.min(250, Math.max(10, localAt - Date.now()))));
    }
    liveState("결투 중 — 상대 화면에서도 같은 결투가 진행됩니다.");
    fast = false;
    try {
      await play(r);
    } finally {
      playing = false;
      liveUi();
      if (live.ws) liveState(r.winner == null ? "무승부! 한 판 더 하려면 둘 다 준비를 누르세요." : r.winner === 0 ? "이겼다! 한 판 더 하려면 둘 다 준비를 누르세요." : "졌다… 한 판 더 하려면 둘 다 준비를 누르세요.");
    }
  }

  $("liveMake").onclick = () => {
    // 6자리. 서버가 이미 있는 방이면 거절하니 겹쳐도 다시 누르면 된다
    liveConnect(String(Math.floor(100000 + Math.random() * 900000)), "host");
  };
  $("liveJoin").onclick = () => {
    const code = $("liveCodeIn").value.replace(/\D/g, "");
    if (code.length !== 6) return liveState("6자리 숫자 코드를 넣어 주세요.", "bad");
    liveConnect(code, "guest");
  };
  $("liveReady").onclick = () => {
    if (!live.ws || !live.peer) return;
    live.ws.send(JSON.stringify({ t: "ready" }));
    $("liveReady").dataset.on = "1";
    liveState("준비했습니다. 상대를 기다리는 중…");
  };
  $("liveLeave").onclick = () => liveClose("방을 나왔습니다.");
  // 방 안에서 포켓몬을 바꾼다 — 새 코드를 다시 보내면 상대 화면도 바뀌고 양쪽 준비가 풀린다
  $("liveMine").addEventListener("change", async () => {
    if (!live.ws || live.ws.readyState !== 1 || playing) return;
    const team = await window.ptb.liveTeam($("liveMine").value);
    if (!team || !team.ok) return liveState((team && team.reason) || "바꾸지 못했습니다", "bad");
    live.myCode = team.code;
    live.justChanged = live.peer ? team.name : null;
    live.ws.send(JSON.stringify({ t: "hello", name: (last.friend && last.friend.trainer) || "", team: live.myCode }));
    delete $("liveReady").dataset.on;
    liveState(`${team.name}(으)로 바꿨습니다.` + (live.peer ? " 둘 다 다시 준비를 눌러 주세요." : " 상대를 기다리는 중…"));
  });
  $("liveCopyCode").onclick = async () => {
    try { await navigator.clipboard.writeText(live.code || ""); } catch {}
    window.toast && toast("방 코드를 복사했습니다");
  };

  /* ---------------- 교환 ----------------
     보내기 → 박스에서 빠지고 코드가 나온다(메인이 한 번 묻는다). 받기 → 같은 코드는 한 번만.
     교환으로 진화하는 아이는 받기 전에 미리 알려 준다 — 받는 맛이 거기 있다. */

  function renderTrade(s) {
    const list = fighters(s);
    const sel = $("trMine");
    const keep = sel.value;
    sel.innerHTML = list.map((m) => `<option value="${m.id}">${m.name} Lv.${m.profile.level}${m.active ? " (키우는 중)" : ""}</option>`).join("");
    if (list.some((m) => m.id === keep)) sel.value = keep;
    else {
      // 처음엔 키우는 아이가 아닌 아이를 골라 둔다 — 키우던 걸 실수로 보내지 않게
      const other = list.find((m) => !m.active);
      if (other) sel.value = other.id;
    }
    $("trSend").disabled = list.length < 2 || (s.box || []).length < 2;
    const sent = (s.friend && s.friend.sent) || [];
    if (sent.length && !$("trSentCode").value) {
      $("trSentBox").hidden = false;
      $("trSentCode").value = sent[0].code;
      $("trSentNote").textContent = `최근에 보낸 아이: ${sent[0].name} — 코드를 잃어버렸으면 여기서 다시 복사하세요.`;
    }
  }

  $("trSend").onclick = async () => {
    const r = await window.ptb.tradeSend($("trMine").value);
    if (!r || !r.ok) {
      if (r && r.reason) $("trSentNote").textContent = r.reason;
      return;
    }
    $("trSentBox").hidden = false;
    $("trSentCode").value = r.code;
    $("trSentNote").textContent = `${r.name}을(를) 보냈습니다. 코드를 복사해서 친구에게 보내세요.`;
    window.toast && toast(`${r.name}을(를) 보냈습니다`);
  };
  $("trCopy").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("trSentCode").value);
    } catch {
      $("trSentCode").select();
      document.execCommand("copy");
    }
    window.toast && toast("코드를 복사했습니다");
  };

  let tradeOk = false;
  let tradeTimer = null;
  $("trIn").addEventListener("input", () => {
    clearTimeout(tradeTimer);
    tradeTimer = setTimeout(async () => {
      const code = $("trIn").value.trim();
      tradeOk = false;
      $("trFoe").hidden = true;
      $("trGet").disabled = true;
      if (!code) return void ($("trInfo").textContent = "");
      const r = await window.ptb.tradeInspect(code);
      if (!r || !r.ok) return void ($("trInfo").textContent = (r && r.reason) || "읽지 못했습니다");
      $("trFoe").hidden = false;
      $("trFoeImg").src = r.url || "";
      $("trFoeTxt").innerHTML =
        `${r.trainer ? r.trainer + "에게서 " : ""}${r.name}${r.shiny ? " ★" : ""} (${r.stage})` +
        (r.evolvesTo ? ` <span class="evo">교환하면 ${r.evolvesTo}(으)로 진화!</span>` : "") +
        (r.stone ? " · 🪨 변하지않는돌을 지니고 온다" : "");
      if (r.used) return void ($("trInfo").textContent = "이미 받은 코드입니다. 같은 코드는 한 번만 받을 수 있습니다.");
      $("trInfo").textContent = r.mine ? "내가 보낸 코드입니다. 받으면 돌아옵니다." : r.ot && r.ot !== r.trainer ? `처음 키운 트레이너: ${r.ot}` : "";
      tradeOk = true;
      $("trGet").disabled = false;
    }, 250);
  });

  $("trGet").onclick = async () => {
    if (!tradeOk) return;
    $("trGet").disabled = true;
    const r = await window.ptb.tradeReceive($("trIn").value.trim());
    if (!r || !r.ok) return void ($("trInfo").textContent = (r && r.reason) || "받지 못했습니다");
    tradeOk = false;
    $("trInfo").textContent = r.evolved
      ? `✨ ${r.before}이(가) 교환으로 ${r.name}(으)로 진화했다! 박스에 들어갔습니다.`
      : r.returned
        ? `${r.name}이(가) 돌아왔습니다.`
        : `${r.name}을(를) 받았습니다. 박스에 들어갔습니다.`;
    window.toast && toast(r.evolved ? `${r.name}(으)로 진화!` : `${r.name}을(를) 받았습니다`);
  };

  $("frGo").onclick = async () => {
    if (playing) return;
    playing = true;
    fast = false;
    $("btlGo").disabled = $("btlDesk").disabled = true;
    updateGo();
    $("btlSkip").hidden = false;
    try {
      const r = await window.ptb.friendBattle($("frTheirs").value.trim());
      if (!r || !r.ok) return void ($("frInfo").textContent = (r && r.reason) || "결투를 시작하지 못했습니다");
      $("arena").scrollIntoView({ behavior: "smooth", block: "start" });
      await play(r);
    } finally {
      playing = false;
      $("btlSkip").hidden = true;
      if (last) fillPick(last);
      updateGo();
    }
  };

  /* ---------------- 재생 ---------------- */

  function setSide(i, m, f) {
    const k = SIDE[i];
    const box = $("side" + k);
    box.querySelector(".nm").textContent = f.label || f.name;
    box.querySelector(".lv").textContent = "Lv." + f.level;
    box.querySelector(".st").textContent = "";
    const img = box.querySelector("img");
    // 친선 배틀의 친구 아이는 내 박스에 없다 — 메인이 그림 주소를 같이 준다
    img.src = (m && (m.animUrl || m.url)) || f.url || "";
    img.classList.toggle("flip", DIR[i] > 0);
    $("body" + k).className = "fbody";
    setHp(i, f.maxHp, f.maxHp, true);
  }

  function setHp(i, hp, max, instant) {
    const k = SIDE[i];
    const bar = $("hp" + k);
    const r = Math.max(0, hp / max);
    bar.style.transition = instant ? "none" : "";
    bar.style.width = r * 100 + "%";
    // 원작처럼 절반 아래는 노랑, 1/5 아래는 빨강
    bar.className = r <= 0.2 ? "red" : r <= 0.5 ? "yellow" : "";
    $("hpn" + k).textContent = `${hp}/${max}`;
  }

  const AIL_SHORT = { paralysis: "마비", burn: "화상", poison: "독", sleep: "잠듦", freeze: "얼음", confusion: "혼란" };

  function line(text, cls = "") {
    if (!text) return;
    const el = document.createElement("div");
    el.textContent = text;
    if (cls) el.className = cls;
    $("btlLog").appendChild(el);
    $("btlLog").scrollTop = $("btlLog").scrollHeight;
  }

  /** 맞은 쪽이 깜빡인다. 데미지가 났다는 게 숫자보다 먼저 보여야 한다 */
  function hit(i) {
    const b = $("body" + SIDE[i]);
    b.classList.remove("hit");
    void b.offsetWidth;
    b.classList.add("hit");
  }

  async function play(r) {
    const byId = Object.fromEntries((last ? last.box : []).map((m) => [m.id, m]));
    r.fighters.forEach((f, i) => setSide(i, byId[f.id], f));
    $("arena").hidden = false;
    $("btlLog").innerHTML = "";
    ensureStages();

    for (const ev of r.log) {
      if (ev.t === "move") {
        line(ev.text, "mv");
        if (!fast) stages[ev.side].play(ev.move, { body: $("body" + SIDE[ev.side]), dir: DIR[ev.side], force: true });
        await sleep(ev.move.damageClass === "status" ? 900 : 650);
      } else if (ev.t === "hp") {
        const before = parseInt($("hpn" + SIDE[ev.side]).textContent, 10);
        if (ev.hp < before) hit(ev.side);
        setHp(ev.side, ev.hp, ev.max);
        line(ev.text);
        await sleep(450);
      } else if (ev.t === "faint") {
        $("body" + SIDE[ev.side]).classList.add("faint");
        line(ev.text, "ft");
        await sleep(700);
      } else {
        if (ev.status !== undefined && ev.side >= 0) {
          $("side" + SIDE[ev.side]).querySelector(".st").textContent =
            ev.status && ev.status !== "unconfused" ? AIL_SHORT[ev.status] || "" : "";
        }
        line(ev.text, ev.side < 0 ? "sys" : ev.eff > 1 ? "good" : ev.eff < 1 ? "bad" : "");
        await sleep(ev.side < 0 ? 300 : 500);
      }
    }

    if (r.friendly) {
      line(r.winner == null ? "무승부!" : r.winner === 0 ? "친선 배틀에서 이겼다!" : "친선 배틀에서 졌다…", "rw");
      line("친선 배틀은 보상이 없습니다. 같은 두 코드로는 몇 번을 해도 같은 결과입니다.", "sys");
    } else if (r.reward) {
      line(`🎁 ${r.reward.name}(${r.reward.flavorName})을 얻었다!`, "rw");
      window.toast && toast(`${r.reward.name}을(를) 얻었습니다`);
    } else if (r.winner != null && !r.rewardsLeft) {
      line("오늘 받을 수 있는 보상은 다 받았습니다. 결투는 계속할 수 있습니다.", "sys");
    }
  }

  $("btlGo").onclick = async () => {
    if (playing) return;
    const a = $("btlA").value;
    const b = $("btlB").value;
    const level = $("btlLv").value === "50" ? 50 : null;
    if (!a || !b || a === b) return void (window.toast && toast("서로 다른 두 마리를 골라 주세요"));
    playing = true;
    fast = false;
    $("btlGo").disabled = true;
    $("btlSkip").hidden = false;
    try {
      const r = await window.ptb.battle({ a, b, level });
      if (!r || !r.ok) return void (window.toast && toast((r && r.reason) || "결투를 시작하지 못했습니다"));
      await play(r);
    } finally {
      playing = false;
      $("btlSkip").hidden = true;
      if (last) fillPick(last);
    }
  };
  /**
   * 바탕화면에서 싸운다. 장면은 펫 창들이 그리고(main desktopBattle), 이 창은 닫힌다.
   * 끝나고 돌아오면 로그만 채워 둔다 — 다시 열었을 때 무슨 일이 있었는지 보이게.
   */
  $("btlDesk").onclick = async () => {
    if (playing) return;
    const a = $("btlA").value;
    const b = $("btlB").value;
    const level = $("btlLv").value === "50" ? 50 : null;
    if (!a || !b || a === b) return void (window.toast && toast("서로 다른 두 마리를 골라 주세요"));
    playing = true;
    $("btlGo").disabled = $("btlDesk").disabled = true;
    $("btlNote").textContent = "바탕화면에서 싸우는 중…";
    try {
      const r = await window.ptb.battleDesktop({ a, b, level });
      if (!r || !r.ok) return void (window.toast && toast((r && r.reason) || "결투를 시작하지 못했습니다"));
      fast = true;
      await play(r);
    } finally {
      fast = false;
      playing = false;
      $("btlNote").textContent = "";
      if (last) fillPick(last);
    }
  };
  // 결과는 이미 정해져 있다. 남은 장면을 건너뛸 뿐이다
  $("btlSkip").onclick = () => (fast = true);
  // A 를 바꾸면 B 가 같은 아이가 되지 않게 다시 맞춘다
  $("btlA").onchange = () => {
    if ($("btlA").value === $("btlB").value) $("btlB").value = "";
    if (last) fillPick(last);
  };
})();
