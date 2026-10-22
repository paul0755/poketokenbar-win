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
