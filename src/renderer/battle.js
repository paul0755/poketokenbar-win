"use strict";
/**
 * 온라인 탭 — 결투(실시간 배틀) · 교환(코드 받기). 방 탭처럼 안에서 둘로 나눈다.
 *
 * 처음엔 "결투" 탭 한 줄에 연습 결투 · 친선 배틀(코드) · 실시간 배틀 · 교환 받기 · 가방을 다 늘어놓았다.
 * 무엇부터 봐야 할지 몰랐다 — 친구와 하는 것만 남겼다. 연습 결투는 바탕화면에서 펫을 끌어 놓으면 되고,
 * 나무열매는 박스 › 상세에서 보인다.
 *
 * 결투 재생은 그대로다 — 메인이 끝까지 계산한 사건 목록(main/battle.js)을 차례로 재생한다.
 * 화면은 승패를 정하지 않는다. 재생 속도만 정한다. 길드원과의 결투(방 › 길드)도 여기서 재생한다.
 *
 * 기술 연출은 펫과 같은 moves.js 를 쓴다. 칸(무대)이 둘이라 create() 로 따로 만든다.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const SIDE = ["A", "B"];
  // A(내 쪽, 왼쪽 아래)는 오른쪽 위를, B(상대, 오른쪽 위)는 왼쪽 아래를 보고 기술을 쓴다
  const DIR = [1, -1];
  /** 받침이 있으면 a, 없으면 b — "망나뇽이" · "비리디온은" */
  const josa = (w, a, b) => {
    const c = String(w).charCodeAt(String(w).length - 1);
    return w + (c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? a : b);
  };

  let stages = null;
  let playing = false;
  let fast = false;
  let last = null; // 마지막으로 받은 갱신
  let cur = null; // 재생 중인 결투의 두 아이 — 변신할 때 서로의 그림을 빌린다

  const ensureStages = () =>
    stages || (stages = SIDE.map((k) => window.ptbMoves.create($("stage" + k))));

  const sleep = (ms) => new Promise((r) => setTimeout(r, fast ? 0 : ms));
  const fighters = (s) => (s.box || []).filter((m) => m.stageKey !== "egg" && m.profile);

  /* ---------------- 결투 · 교환 나누기 ---------------- */

  const HINT = { battle: "친구와 같은 결투를 동시에", trade: "예전 교환 코드 받기" };
  function setView(v) {
    for (const x of $("olSwitch").querySelectorAll("button")) x.classList.toggle("on", x.dataset.view === v);
    $("olBattle").hidden = v !== "battle";
    $("olTrade").hidden = v !== "trade";
    $("olHint").textContent = HINT[v] || "";
  }
  $("olSwitch").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]");
    if (b) setView(b.dataset.view);
  });

  window.ptb.onStats((s) => {
    if (!s || !s.box) return;
    last = s;
    liveUi();
  });

  /* ---------------- 포켓몬 카드 · 고르기 ---------------- */

  /** 카드 한 장 — 그림 · 이름 · 별 · 레벨 · 타입. 셀렉트 한 줄로는 누구인지 안 보였다 */
  function monCard(m) {
    if (!m) return `<div class="olwait">싸울 수 있는 아이가<br />없습니다</div>`;
    const p = m.profile || {};
    const tys = (p.typeKeys || []).map((k, i) => `<span class="ty t-${k}">${esc((p.types || [])[i])}</span>`).join("");
    return `<img src="${esc(m.animUrl || m.url || "")}" alt="" />
      <div class="olnm">${esc(m.name)}${m.shiny ? " ★" : ""}</div>
      <div class="olmeta"><span class="st">${"★".repeat(m.stars || 0)}</span> Lv.${p.level ?? "?"} → 50</div>
      <div class="oltys">${tys}</div>`;
  }

  function pickGrid(list, cur) {
    return list
      .map((m) => `<button data-id="${esc(m.id)}" class="${m.id === cur ? "on" : ""}" title="${esc(m.name)} Lv.${m.profile.level}">
        <img src="${esc(m.url || "")}" alt="" /><span class="n">${esc(m.name)}</span><span class="l">Lv.${m.profile.level}${m.active ? " · 키우는 중" : ""}</span></button>`)
      .join("");
  }

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
    $("liveStatus").className = "olstatus " + cls;
  }

  /**
   * 내 포켓몬 고르기. 셀렉트(liveMine)는 값만 들고 숨어 있고, 화면은 카드와 그림 목록이다.
   * 방 안에서도 바꿀 수 있다 — 바꾸면 change 이벤트로 새 코드를 보낸다(아래)
   */
  function fillLiveMine(s) {
    const sel = $("liveMine");
    const keep = sel.value;
    const list = fighters(s);
    sel.innerHTML = list.map((m) => `<option value="${esc(m.id)}"></option>`).join("");
    if (list.some((m) => m.id === keep)) sel.value = keep;
    else sel.value = (list.find((m) => m.active) || list[0] || {}).id || "";
    $("liveMineCard").innerHTML = monCard(list.find((m) => m.id === sel.value));
    if (!$("livePick").hidden) $("livePickGrid").innerHTML = pickGrid(list, sel.value);
  }

  $("liveMineCard").onclick = () => {
    const open = $("livePick").hidden;
    $("livePick").hidden = !open;
    if (open && last) $("livePickGrid").innerHTML = pickGrid(fighters(last), $("liveMine").value);
  };
  $("livePickClose").onclick = () => ($("livePick").hidden = true);
  $("livePickGrid").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]");
    if (!b) return;
    $("liveMine").value = b.dataset.id;
    $("livePick").hidden = true;
    if (last) fillLiveMine(last);
    $("liveMine").dispatchEvent(new Event("change"));
  });

  function showFoe(img, text) {
    const on = Boolean(text);
    $("liveFoe").classList.toggle("on", on);
    $("liveFoeWait").hidden = on;
    $("liveFoeImg").hidden = !img;
    $("liveFoeImg").src = img || "";
    $("liveFoeTxt").textContent = text || "";
  }

  function liveUi() {
    const s = last;
    const on = liveOn(s);
    const inRoom = Boolean(live.ws);
    if (s) fillLiveMine(s);
    $("liveMine").disabled = $("liveMineCard").disabled = !on || playing; // 결투 중에는 못 바꾼다. 방 안에서는 바꿀 수 있다
    if ($("liveMineCard").disabled) $("livePick").hidden = true;
    $("liveMake").disabled = $("liveJoin").disabled = !on || !$("liveMine").value || inRoom || playing;
    $("liveCodeIn").disabled = !on || inRoom;
    $("liveJoinRow").hidden = inRoom; // 방에 들어가면 방 코드 · 준비 · 나가기만 남긴다
    $("liveLeave").hidden = !inRoom;
    $("liveReady").hidden = !(inRoom && live.peer);
    $("liveReady").disabled = playing || !live.peer || !live.peer.ok;
    if (!on) liveState("설정 › 온라인 기능을 켜면 쓸 수 있습니다. 보내는 건 팀 코드와 이름뿐입니다.");
    else if (!inRoom) liveState("내 포켓몬을 고르고, 방을 만들거나 친구에게 받은 코드로 참가하세요.");
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
    showFoe(null, null);
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
        if (r && r.ok) showFoe(r.url || null, `${m.name || r.trainer || "상대"}의 ${r.name}${r.shiny ? " ★" : ""}`);
        else showFoe(null, "상대 팀을 읽지 못했습니다");
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
        showFoe(null, null);
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
    while (Date.now() < localAt) {
      liveState(`${Math.ceil((localAt - Date.now()) / 1000)}초 뒤 시작!`);
      await new Promise((res) => setTimeout(res, Math.min(250, Math.max(10, localAt - Date.now()))));
    }
    liveState("결투 중 — 상대 화면에서도 같은 결투가 진행됩니다.");
    fast = false;
    try {
      // 같은 결투를 동시에 본다 — 건너뛰기는 두지 않는다
      await play(r, { title: "📡 실시간 배틀", skip: false });
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
  $("liveCodeIn").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !$("liveJoin").disabled) $("liveJoin").click();
  });
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

  /* ---------------- 교환 받기 ----------------
     교환은 길드 몰로 바뀌었다. 예전에 받은 코드(PTBT-…)만 여기서 받는다 — 같은 코드는 한 번만.
     교환으로 진화하는 아이는 받기 전에 미리 알려 준다 — 받는 맛이 거기 있다. */

  let tradeOk = false;
  let tradeTimer = null;
  const tradeNote = (t) => ($("trNote").textContent = t || "");
  $("trIn").addEventListener("input", () => {
    clearTimeout(tradeTimer);
    tradeTimer = setTimeout(async () => {
      const code = $("trIn").value.trim();
      tradeOk = false;
      $("trFoe").hidden = true;
      $("trGet").disabled = true;
      tradeNote("");
      if (!code) return;
      const r = await window.ptb.tradeInspect(code);
      if (!r || !r.ok) return tradeNote((r && r.reason) || "읽지 못했습니다");
      $("trFoe").hidden = false;
      $("trFoeImg").src = r.url || "";
      $("trFoeTxt").innerHTML =
        `${esc(r.name)}${r.shiny ? " ★" : ""} <span class="trsub">(${esc(r.stage)})</span>` +
        (r.evolvesTo ? `<br /><span class="evo">✨ 교환하면 ${esc(r.evolvesTo)}(으)로 진화!</span>` : "");
      $("trInfo").textContent = [
        r.trainer ? `${r.trainer}에게서` : "",
        r.ot && r.ot !== r.trainer ? `처음 키운 트레이너: ${r.ot}` : "",
        r.stone ? "🪨 변하지않는돌을 지니고 온다" : "",
      ].filter(Boolean).join(" · ");
      if (r.used) return tradeNote("이미 받은 코드입니다. 같은 코드는 한 번만 받을 수 있습니다.");
      if (r.mine) tradeNote("내가 보낸 코드입니다. 받으면 돌아옵니다.");
      tradeOk = true;
      $("trGet").disabled = false;
    }, 250);
  });

  $("trGet").onclick = async () => {
    if (!tradeOk) return;
    $("trGet").disabled = true;
    const r = await window.ptb.tradeReceive($("trIn").value.trim());
    if (!r || !r.ok) return tradeNote((r && r.reason) || "받지 못했습니다");
    tradeOk = false;
    tradeNote(r.evolved
      ? `✨ ${r.before}이(가) 교환으로 ${r.name}(으)로 진화했다! 박스에 들어갔습니다.`
      : r.returned
        ? `${r.name}이(가) 돌아왔습니다.`
        : `${r.name}을(를) 받았습니다. 박스에 들어갔습니다.`);
    window.toast && toast(r.evolved ? `${r.name}(으)로 진화!` : `${r.name}을(를) 받았습니다`);
  };

  $("olGoMall").onclick = () => {
    setTab("shop");
    const b = document.querySelector('#shSwitch button[data-view="mall"]');
    if (b) b.click();
  };

  /**
   * 길드원과 결투 — 방 탭의 길드 화면이 부른다(guild.js). 결과는 메인이 끝까지 계산하고
   * 여기서 온라인 탭으로 넘어와 재생만 한다(Lv.50, 보상 없음).
   */
  window.ptbGuildBattle = async (memberId) => {
    if (playing) return { ok: false, reason: "이미 결투 중입니다" };
    const r = await window.ptb.guildBattle(memberId);
    if (!r || !r.ok) return r || { ok: false };
    setTab("battle");
    setView("battle");
    playing = true;
    fast = false;
    liveUi();
    try {
      await play(r, { title: "🏰 길드원과 결투", skip: true });
    } finally {
      playing = false;
      liveUi();
    }
    return { ok: true };
  };

  /* ---------------- 재생 ---------------- */

  /** 앞모습 · 뒷모습. 내 쪽(0)은 뒤에서 본다 — 뒷모습이 없는 종이면 앞모습을 뒤집어 상대를 보게 한다 */
  function setImg(img, i, f, m) {
    const front = f.url || (m && (m.animUrl || m.url)) || "";
    const back = i === 0 ? f.backUrl : null;
    img.src = back || front;
    img.classList.toggle("flip", i === 0 && !back);
  }

  function setSide(i, m, f) {
    const k = SIDE[i];
    const box = $("side" + k);
    box.querySelector(".nm").textContent = f.label || f.name;
    box.querySelector(".lv").textContent = "Lv." + f.level;
    box.querySelector(".st").textContent = "";
    // 상대 아이는 내 박스에 없다 — 메인이 그림 주소를 같이 준다
    setImg($("body" + k).querySelector("img"), i, f, m);
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

  /** 대사 창 — 한 글자씩 찍는다. 다 찍으면 ▼ 가 깜빡인다. 건너뛰는 중이면 바로 */
  let typing = null;
  function say(text, cls = "") {
    const box = $("btlMsg");
    const el = $("btlMsgText");
    clearInterval(typing);
    box.className = "msgbox " + cls;
    if (fast) {
      el.textContent = text;
      return box.classList.add("idle");
    }
    let n = 0;
    el.textContent = "";
    typing = setInterval(() => {
      n += 2;
      el.textContent = text.slice(0, n);
      if (n >= text.length) {
        clearInterval(typing);
        box.classList.add("idle");
      }
    }, 16);
  }

  /** 기록에 한 줄 — quiet 면 대사 창은 그대로 두고 기록에만 */
  function line(text, cls = "", quiet = false) {
    if (!text) return;
    if (!quiet) say(text, cls === "good" || cls === "ft" ? cls : "");
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

  /** 끝나면 크게 — 로그 맨 아래 한 줄로는 이겼는지 졌는지 놓쳤다. 왼쪽(0)이 늘 내 쪽이다 */
  function showResult(r) {
    const el = $("btlResult");
    const [a, b] = r.fighters.map((f) => f.label || f.name);
    el.className = "btlresult " + (r.winner === 0 ? "win" : r.winner === 1 ? "lose" : "");
    el.innerHTML = (r.winner == null ? "🤝 무승부" : r.winner === 0 ? "🏆 이겼다!" : "졌다…") + `<small>${esc(a)} VS ${esc(b)}</small>`;
    el.hidden = false;
  }

  async function play(r, { title = "결투", skip = true } = {}) {
    const byId = Object.fromEntries((last ? last.box : []).map((m) => [m.id, m]));
    cur = r.fighters;
    r.fighters.forEach((f, i) => setSide(i, byId[f.id], f));
    $("btlTitle").textContent = title;
    $("btlShow").hidden = false;
    $("btlResult").hidden = true;
    $("btlClose").hidden = true;
    $("btlSkip").hidden = !skip;
    $("btlLog").innerHTML = "";
    $("btlShow").scrollIntoView({ behavior: "smooth", block: "start" });
    ensureStages();
    // 들어오는 장면을 다시 틀려면 클래스를 뗐다 붙인다
    const scene = $("arena");
    scene.classList.remove("enter");
    void scene.offsetWidth;
    scene.classList.add("enter");
    say(`${josa(r.fighters[1].label || r.fighters[1].name, "이", "가")} 승부를 걸어왔다!`);
    await sleep(1100);
    say(`가랏, ${r.fighters[0].name}!`);
    await sleep(800);

    try {
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
          if (ev.transform && ev.side >= 0 && cur) {
            // 변신 — 상대의 모습을 빌린다. 내 쪽이면 상대의 뒷모습, 상대 쪽이면 내 앞모습
            const theirs = cur[ev.transform.side];
            setImg($("body" + SIDE[ev.side]).querySelector("img"), ev.side, { url: theirs.url, backUrl: theirs.backUrl }, null);
          }
          if (ev.status !== undefined && ev.side >= 0) {
            $("side" + SIDE[ev.side]).querySelector(".st").textContent =
              ev.status && ev.status !== "unconfused" ? AIL_SHORT[ev.status] || "" : "";
          }
          line(ev.text, ev.side < 0 ? "sys" : ev.eff > 1 ? "good" : ev.eff < 1 ? "bad" : "");
          await sleep(ev.side < 0 ? 300 : 500);
        }
      }
      showResult(r);
      say(r.winner == null ? "승부가 나지 않았다!" : r.winner === 0 ? `${r.fighters[0].name}의 승리!` : `${josa(r.fighters[0].name, "은", "는")} 지고 말았다…`);
      line("친구와의 결투는 보상이 없습니다.", "sys", true);
    } finally {
      fast = false;
      $("btlSkip").hidden = true;
      $("btlClose").hidden = false;
    }
  }

  // 결과는 이미 정해져 있다. 남은 장면을 건너뛸 뿐이다
  $("btlSkip").onclick = () => (fast = true);
  $("btlClose").onclick = () => ($("btlShow").hidden = true);
})();
