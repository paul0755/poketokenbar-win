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
    $("btlGo").disabled = playing || list.length < 2;
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
  });

  /* ---------------- 재생 ---------------- */

  function setSide(i, m, f) {
    const k = SIDE[i];
    const box = $("side" + k);
    box.querySelector(".nm").textContent = f.name;
    box.querySelector(".lv").textContent = "Lv." + f.level;
    box.querySelector(".st").textContent = "";
    const img = box.querySelector("img");
    img.src = (m && (m.animUrl || m.url)) || "";
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
        if (!fast) stages[ev.side].play(ev.move, { body: $("body" + SIDE[ev.side]), dir: DIR[ev.side] });
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

    if (r.reward) {
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
  // 결과는 이미 정해져 있다. 남은 장면을 건너뛸 뿐이다
  $("btlSkip").onclick = () => (fast = true);
  // A 를 바꾸면 B 가 같은 아이가 되지 않게 다시 맞춘다
  $("btlA").onchange = () => {
    if ($("btlA").value === $("btlB").value) $("btlB").value = "";
    if (last) fillPick(last);
  };
})();
