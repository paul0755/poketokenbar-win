"use strict";
/**
 * 체육관 — 배틀 탭의 🏟️ 체육관 · 🎫 주간 도전 두 칸이 같은 화면(#olGym)을 쓴다(mode).
 *   🏟️ 체육관 — 배지 케이스 · 관장 카드 · 내 팀 고르기 · 도전. 스토리 관장 8명, 배지는 영구
 *   🎫 주간 도전 — 증표 케이스 · 그 주의 상대 8명(아무 순서로) · 🏆 챔피언 로드(증표 8개 뒤)
 *
 * 승패와 보상은 메인이 정한다(main/gym.js · gymChallenge). 여기서는 판마다의 결투를
 * 결투 화면(battle.js 의 ptbArena)에 차례로 틀기만 한다. 같은 무대를 쓰므로 실시간 배틀과 겹치지 않게
 * 재생하는 동안은 ptbArena.hold 로 붙잡아 둔다.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const art = () => window.ptbGymArt;
  const arena = () => window.ptbArena;

  let data = null; // gymList 결과
  let mode = "gym"; // "gym" 스토리 체육관 · "weekly" 주간 도전
  let sel = null; // 보고 있는 체육관 id(주간 도전이면 상대 id 또는 "road")
  const sels = { gym: null, weekly: null }; // 칸을 오갈 때 보던 것을 기억한다
  let picks = []; // 고른 내 아이 id — 고른 순서대로 나간다
  let last = null; // 마지막 갱신(박스)
  let busy = false;

  const fighters = (s) => (s && s.box ? s.box.filter((m) => m.stageKey !== "egg" && m.profile) : []);
  const isWeekly = () => mode === "weekly";
  const isRoad = () => isWeekly() && sel === "road";
  /** 데려갈 수 있는 수 — 체육관 3, 챔피언 로드 6 */
  const maxPick = () => (isRoad() && data && data.road ? data.road.pick : 3);
  /** 로드 카드에 크게 보일 관문 — 지금 관문, 다 깼으면 챔피언 */
  const roadStage = () => {
    const r = data && data.road;
    return r ? r.stages.find((x) => x.state === "now") || r.stages[r.stages.length - 1] : null;
  };

  /**
   * 처음 볼 곳. 체육관 — 아직 못 딴 것 중 열린 첫 곳(다 땄으면 마지막).
   * 주간 도전 — 증표를 아직 못 받은 첫 상대. 다 받았으면(로드가 열렸으면) 챔피언 로드
   */
  const firstOpen = (d) => {
    if (isWeekly()) {
      const g = d.weekly.stages.find((x) => !x.got);
      return g ? g.id : d.road && d.road.open ? "road" : d.weekly.stages[0].id;
    }
    const g = d.gyms.find((x) => x.open && !x.got);
    return g ? g.id : d.gyms[d.gyms.length - 1].id;
  };
  const valid = (d, id) =>
    isWeekly() ? id === "road" || d.weekly.stages.some((x) => x.id === id) : d.gyms.some((g) => g.id === id);

  async function load() {
    const d = await window.ptb.gymList();
    if (!d) return;
    data = d;
    // 🎫 주간 도전 칸은 체육관 배지 8개를 다 모은 사람에게만 보인다
    const tab = $("olWeeklyTab");
    if (tab) tab.hidden = !(d.weekly && d.weekly.open);
    if (isWeekly() && !(d.weekly && d.weekly.open) && window.ptbBattleView) return window.ptbBattleView("gym");
    if (!sel || !valid(d, sel)) { sel = firstOpen(d); fitPicks(); }
    render();
  }
  /** 배틀 탭의 칸을 눌렀을 때(battle.js) — v 는 "gym" · "weekly" */
  window.ptbGymOpen = (v) => {
    if (v && v !== mode && !busy) {
      sels[mode] = sel;
      mode = v;
      sel = sels[v];
      fitPicks();
      if (data) render();
    }
    return load();
  };

  window.ptb.onStats((s) => {
    if (!s || !s.box) return;
    last = s;
    // 놓아주거나 알로 돌아간 아이는 뺀다. 처음이면 키우는 아이와 레벨 높은 순으로 채운다
    const ok = new Set(fighters(s).map((m) => m.id));
    picks = picks.filter((id) => ok.has(id));
    if (!picks.length && !busy) picks = defaultPicks(s, maxPick());
    if (data) renderPick();
  });

  function defaultPicks(s, n = 3) {
    const list = fighters(s).slice().sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || b.profile.level - a.profile.level);
    return list.slice(0, n).map((m) => m.id);
  }

  /** 체육관 ↔ 로드를 오갈 때 — 로드는 6마리까지 채워 주고, 체육관으로 돌아오면 앞의 셋만 */
  function fitPicks() {
    const n = maxPick();
    if (picks.length > n) picks = picks.slice(0, n);
    else if (isRoad() && picks.length < n && last) {
      for (const id of defaultPicks(last, 99)) if (picks.length < n && !picks.includes(id)) picks.push(id);
    }
  }

  /* ---------------- 그리기 ---------------- */

  const TIP_GYM = `레벨은 맞추지 않습니다 — 관장의 레벨만큼 키워서 오세요. 한 마리가 쓰러지면 다음 아이가 나오고, 이긴 아이는 깎인 체력 그대로 다음 상대와 싸웁니다.
    지면 이번 주 도전 횟수가 하나 줄고(이기면 그대로), 월요일에 다시 찹니다. 배지는 한 번 따면 계속 남습니다 — 처음 따면 🍬, 8개를 다 모으면 전설의 알.
    <br>🎫 배지 8개 뒤에는 <b>주간 도전</b> — 매주 바뀌는 상대 8명. 그 주의 증표 8개를 모으면 <b>챔피언 로드</b>가 열립니다.`;
  const tipWeekly = (W) => `매주 월요일에 상대 8명이 바뀌고 증표도 처음부터 다시 모읍니다. 순서 없이 아무나 골라 붙으세요 — 오른쪽 상대일수록 셉니다.
    이기면 증표 하나와 🍬${W.candy}, 지면 이번 주 도전 횟수가 하나 줄어듭니다(체육관 · 챔피언 로드와 따로). 지금까지 받은 증표 ${W.all}개.
    <br>🏆 증표 8개를 다 모으면 그 주 <b>챔피언 로드</b> — 관장 셋의 재대결과 챔피언. 6마리까지 데려갑니다.`;

  function render() {
    if (!data) return;
    const R = data.road;
    const W = data.weekly;
    $("gyCaseT").textContent = isWeekly() ? "증표 케이스" : "배지 케이스";
    $("gyCount").textContent = isWeekly() ? `${W.got} / ${W.total}` : `${data.badges} / ${data.gyms.length}`;
    const tries = isRoad() ? R.tries : isWeekly() ? W.tries : data.tries;
    const max = isRoad() ? R.max : isWeekly() ? W.max : data.max;
    $("gyTries").textContent = `${isRoad() ? "챔피언 로드" : "이번 주"} 남은 도전 ${tries} / ${max}`;
    $("gyTries").classList.toggle("out", tries <= 0);
    renderRoadBtn();
    $("gyBadges").innerHTML = isWeekly()
      ? W.stages
          .map((g) => `<button data-id="${g.id}" class="${g.id === sel ? "on" : ""}${g.got ? " got" : ""}${W.open ? "" : " lock"}" title="${esc(g.token)} — ${esc(g.title)} ${esc(g.name)}">
          ${art().token(g.id, g.got, 34)}<span>${esc(g.name)}</span></button>`)
          .join("")
      : data.gyms
          .map((g) => `<button data-id="${g.id}" class="${g.id === sel ? "on" : ""}${g.got ? " got" : ""}${g.open ? "" : " lock"}" title="${esc(g.badge)} — ${esc(g.name)}">
          ${art().badge(g.id, g.got, 34)}<span>${g.n + 1}</span></button>`)
          .join("");
    $("gyTip").innerHTML = isWeekly() ? tipWeekly(W) : TIP_GYM;
    renderCard();
    renderPick();
  }

  /** 케이스 아래 한 줄 — 체육관에서는 🎫 주간 도전으로 가는 길, 주간 도전에서는 🏆 챔피언 로드 */
  function renderRoadBtn() {
    const R = data.road;
    const W = data.weekly;
    const b = $("gyRoad");
    if (!isWeekly()) {
      b.hidden = !W || !W.open; // 배지 8개 전에는 주간 도전 줄도 숨긴다
      if (b.hidden) return;
      b.className = "gyroad";
      const st = W.open ? `이번 주 증표 ${W.got} / ${W.total}` : "배지 8개를 모으면 열립니다";
      b.innerHTML = `${art().token(W.stages[0].id, W.got > 0, 26)}<b>주간 도전</b><span class="st">${esc(st)}</span><span class="rc">매주 바뀌는 상대 8명 ›</span>`;
      return;
    }
    if (!R) { b.hidden = true; return; }
    b.hidden = false;
    b.className = "gyroad" + (isRoad() ? " on" : "") + (R.open ? "" : " lock");
    const st = !R.open ? (W.open ? "이번 주 증표 8개를 모으면 열립니다" : "배지 8개를 모으면 열립니다")
      : R.cleared >= R.total ? "이번 주 챔피언 ✓"
      : `이번 주 ${R.cleared} / ${R.total} 관문`;
    const rc = R.record.clears ? `챔피언 ${R.record.clears}회${R.record.streak > 1 ? ` · ${R.record.streak}주 연속` : ""}` : "";
    b.innerHTML = `${art().badge("champ", R.record.clears > 0, 26)}<b>챔피언 로드</b><span class="st">${esc(st)}</span><span class="rc">${esc(rc)}</span>`;
  }

  function renderRoadCard() {
    const R = data.road;
    const g = roadStage();
    const done = R.cleared >= R.total;
    const ace = Math.max(...g.team.map((t) => t.lv));
    const team = g.team
      .map((t) => `<div class="gymon"><img src="${esc(t.url || "")}" alt="" /><span class="n">${esc(t.name)}</span><span class="l">Lv.${t.lv}</span></div>`)
      .join("");
    const steps = R.stages
      .map((x, k) => `<div class="rdstep ${x.state}">${x.state === "done" ? '<i class="ck">✓</i>' : ""}${art().portrait(x.champ ? "champ" : x.base, 38)}
        <b>${esc(x.name)}</b><span>${x.champ ? "챔피언" : `${k + 1}관문`}</span></div>`)
      .join("");
    const state = !R.open
      ? `<span class="gystate lock">🔒 ${data.weekly.open ? "이번 주 증표 8개를" : "체육관 배지 8개를"} 모두 모으면 열립니다</span>`
      : done ? `<span class="gystate got">🏆 이번 주 챔피언!</span>`
      : `<span class="gystate">${g.champ ? "마지막 관문 — 챔피언" : `${R.cleared + 1}번째 관문 · 재대결`}</span>`;
    const rec = `<div class="rdrec"><span>챔피언 <b>${R.record.clears}</b>회</span><span>연속 <b>${R.record.streak}</b>주</span><span>최고 <b>${R.record.best}</b>주</span>
      <span>보상 관문 🍬${R.candy} · 챔피언 🍬${R.champCandy}${R.record.clears ? "" : " · 처음이면 마스터볼"}</span></div>`;
    const hall = R.hall.length
      ? `<div class="rdhall"><div class="gycap2">명예의 전당</div>${R.hall
          .map((h) => `<div class="row"><span>${esc(h.week.slice(5).replace("-", "/"))} 주</span>${h.team.map((x) => (x.url ? `<img src="${esc(x.url)}" alt="" title="${esc(x.name)}" />` : "")).join("")}</div>`)
          .join("")}</div>`
      : "";
    $("gyCard").className = "gycard t-champ" + (R.open ? "" : " lock");
    $("gyCard").innerHTML = `
      <div class="gyportrait">${art().portrait(g.champ ? "champ" : g.base, 92)}</div>
      <div class="gyinfo">
        <div class="gyno">🏆 챔피언 로드 · 이번 주 · <span class="ty t-${g.type}">${esc(g.typeName)}</span></div>
        <div class="gyname">${g.champ ? "챔피언" : "관장"} <b>${esc(g.name)}</b><small>${esc(g.title)}${g.champ ? "" : " · 재대결"}</small></div>
        <div class="gysay">“${esc(g.intro)}”</div>
        ${state}
      </div>
      <div class="rdsteps">${steps}</div>
      <div class="gyteam"><div class="gycap2">${g.champ ? "챔피언" : "관장"}의 팀 · 에이스 Lv.${ace}</div><div class="gymons">${team}</div></div>
      ${rec}${hall}`;
  }

  /** 🎫 주간 도전 상대 카드 — 자리(k)가 오른쪽일수록 세다 */
  function renderWeeklyCard() {
    const W = data.weekly;
    const g = W.stages.find((x) => x.id === sel);
    if (!g) return;
    const ace = Math.max(...g.team.map((t) => t.lv));
    const team = g.team
      .map((t) => `<div class="gymon"><img src="${esc(t.url || "")}" alt="" /><span class="n">${esc(t.name)}</span><span class="l">Lv.${t.lv}</span></div>`)
      .join("");
    const stars = "★".repeat(1 + Math.floor(g.k / 2)) + "☆".repeat(3 - Math.floor(g.k / 2));
    const state = !W.open
      ? `<span class="gystate lock">🔒 체육관 배지 8개를 모두 모으면 열립니다</span>`
      : g.got ? `<span class="gystate got"><i class="emo">🎫</i> ${esc(g.token)} 획득</span>` : `<span class="gystate">도전할 수 있음 · 🍬${W.candy}</span>`;
    $("gyCard").className = "gycard t-" + g.type + (W.open ? "" : " lock");
    $("gyCard").innerHTML = `
      <div class="gyportrait">${art().portrait(g.id, 92)}</div>
      <div class="gyinfo">
        <div class="gyno">🎫 이번 주 상대 · <span class="ty t-${g.type}">${esc(g.typeName)}</span> · <span class="gystar" title="세기">${stars}</span></div>
        <div class="gyname">${esc(g.title)} <b>${esc(g.name)}</b><small>${esc(g.token)}</small></div>
        <div class="gysay">“${esc(g.intro)}”</div>
        ${state}
      </div>
      <div class="gyteam"><div class="gycap2">${esc(g.name)}의 팀 · 에이스 Lv.${ace}</div><div class="gymons">${team}</div></div>`;
  }

  function renderCard() {
    if (isRoad() && data.road) return renderRoadCard();
    if (isWeekly()) return renderWeeklyCard();
    const g = data.gyms.find((x) => x.id === sel);
    if (!g) return;
    const ace = Math.max(...g.team.map((t) => t.lv));
    const team = g.team
      .map((t) => `<div class="gymon"><img src="${esc(t.url || "")}" alt="" /><span class="n">${esc(t.name)}</span><span class="l">Lv.${t.lv}</span></div>`)
      .join("");
    const state = g.got
      ? `<span class="gystate got">🏅 ${esc(g.badge)} 획득</span>`
      : g.open ? `<span class="gystate">도전할 수 있음</span>` : `<span class="gystate lock">🔒 ${esc(data.gyms[g.n - 1].badge)}가 있어야 열립니다</span>`;
    $("gyCard").className = "gycard t-" + g.type + (g.open ? "" : " lock");
    $("gyCard").innerHTML = `
      <div class="gyportrait">${art().portrait(g.id, 92)}</div>
      <div class="gyinfo">
        <div class="gyno">${g.n + 1}번째 체육관 · <span class="ty t-${g.type}">${esc(g.typeName)}</span></div>
        <div class="gyname">관장 <b>${esc(g.name)}</b><small>${esc(g.title)}</small></div>
        <div class="gysay">“${esc(g.intro)}”</div>
        ${state}
      </div>
      <div class="gyteam"><div class="gycap2">관장의 팀 · 에이스 Lv.${ace}</div><div class="gymons">${team}</div></div>`;
  }

  function renderPick() {
    if (!data) return;
    const list = fighters(last);
    const byId = Object.fromEntries(list.map((m) => [m.id, m]));
    $("gyPickCap").textContent = `최대 ${maxPick()}마리 · 고른 순서대로 나갑니다`;
    $("gySlots").innerHTML = Array.from({ length: maxPick() }, (_, k) => k)
      .map((k) => {
        const m = byId[picks[k]];
        return m
          ? `<button class="gyslot on" data-id="${esc(m.id)}" title="빼기"><i>${k + 1}</i><img src="${esc(m.url || "")}" alt="" /><span class="n">${esc(m.name)}</span><span class="l">Lv.${m.profile.level}</span></button>`
          : `<div class="gyslot"><i>${k + 1}</i><span class="n dim">비어 있음</span></div>`;
      })
      .join("");
    $("gyGrid").innerHTML = list
      .slice()
      .sort((a, b) => b.profile.level - a.profile.level)
      .map((m) => {
        const k = picks.indexOf(m.id);
        return `<button data-id="${esc(m.id)}" class="${k >= 0 ? "on" : ""}" title="${esc(m.name)} Lv.${m.profile.level}">
          ${k >= 0 ? `<i class="ord">${k + 1}</i>` : ""}<img src="${esc(m.url || "")}" alt="" /><span class="n">${esc(m.name)}</span><span class="l">Lv.${m.profile.level}${m.active ? " · 키우는 중" : ""}</span></button>`;
      })
      .join("");
    updateGo();
  }

  /** 도전 버튼과 한 줄 안내 — 레벨이 모자라 보이면 미리 말해 준다(막지는 않는다) */
  function updateGo() {
    if (isRoad()) return updateRoadGo();
    if (isWeekly()) return updateWeeklyGo();
    const g = data && data.gyms.find((x) => x.id === sel);
    const list = fighters(last);
    const top = Math.max(0, ...list.filter((m) => picks.includes(m.id)).map((m) => m.profile.level));
    const ace = g ? Math.max(...g.team.map((t) => t.lv)) : 0;
    const why = !g ? "" : !g.open ? "앞 체육관의 배지가 먼저 필요합니다."
      : data.tries <= 0 ? "이번 주 도전 횟수를 다 썼습니다. 월요일에 다시 찹니다."
      : !picks.length ? "함께 싸울 아이를 골라 주세요."
      : "";
    $("gyGo").disabled = Boolean(why) || busy || (arena() && arena().busy());
    $("gyGo").textContent = g && g.got ? "🏟️ 다시 도전하기 (보상 없음)" : "🏟️ 도전하기";
    $("gyNote").className = "gynote" + (why ? " bad" : top && top < ace - 5 ? " warn" : "");
    $("gyNote").textContent = why || (top && top < ace - 5 ? `내 팀 최고 Lv.${top} — 관장 에이스는 Lv.${ace}입니다. 더 키워서 오는 게 좋겠어요.` : "");
  }

  function updateWeeklyGo() {
    const W = data && data.weekly;
    const g = W && W.stages.find((x) => x.id === sel);
    const list = fighters(last);
    const top = Math.max(0, ...list.filter((m) => picks.includes(m.id)).map((m) => m.profile.level));
    const ace = g ? Math.max(...g.team.map((t) => t.lv)) : 0;
    const why = !W || !W.open ? "체육관 배지 8개를 모두 모아야 열립니다."
      : W.tries <= 0 ? "이번 주 주간 도전 횟수를 다 썼습니다. 월요일에 다시 찹니다."
      : !picks.length ? "함께 싸울 아이를 골라 주세요."
      : "";
    $("gyGo").disabled = Boolean(why) || busy || (arena() && arena().busy());
    $("gyGo").innerHTML = '<i class="emo">🎫</i> ' + (!g ? "도전하기" : g.got ? "다시 도전하기 (보상 없음)" : `${esc(g.name)}에게 도전`);
    $("gyNote").className = "gynote" + (why ? " bad" : top && top < ace - 5 ? " warn" : "");
    $("gyNote").textContent = why || (top && top < ace - 5 ? `내 팀 최고 Lv.${top} — 상대 에이스는 Lv.${ace}입니다.` : "");
  }

  function updateRoadGo() {
    const R = data && data.road;
    const g = roadStage();
    const list = fighters(last);
    const top = Math.max(0, ...list.filter((m) => picks.includes(m.id)).map((m) => m.profile.level));
    const ace = g ? Math.max(...g.team.map((t) => t.lv)) : 0;
    const why = !R || !R.open ? (data.weekly.open ? "이번 주 증표 8개를 모두 모아야 열립니다." : "체육관 배지 8개를 모두 모아야 열립니다.")
      : R.tries <= 0 ? "이번 주 챔피언 로드 도전 횟수를 다 썼습니다. 월요일에 다시 찹니다."
      : !picks.length ? "함께 싸울 아이를 골라 주세요."
      : "";
    $("gyGo").disabled = Boolean(why) || busy || (arena() && arena().busy());
    $("gyGo").textContent = !g ? "🏆 도전하기" : R.cleared >= R.total ? `🏆 챔피언 ${g.name}와 다시 (보상 없음)` : g.champ ? `🏆 챔피언 ${g.name}에게 도전` : `🏆 관장 ${g.name}에게 재도전`;
    $("gyNote").className = "gynote" + (why ? " bad" : top && top < ace - 5 ? " warn" : "");
    $("gyNote").textContent = why || (top && top < ace - 5 ? `내 팀 최고 Lv.${top} — 상대 에이스는 Lv.${ace}입니다.` : "");
  }

  $("gyRoad").onclick = () => {
    if (busy) return;
    if (!isWeekly()) return window.ptbBattleView && window.ptbBattleView("weekly"); // 🎫 주간 도전 칸으로
    sel = "road";
    fitPicks();
    render();
  };

  /* ---------------- 고르기 ---------------- */

  $("gyBadges").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]");
    if (!b || busy) return;
    sel = b.dataset.id;
    fitPicks();
    render();
  });

  function toggle(id) {
    if (busy) return;
    const k = picks.indexOf(id);
    if (k >= 0) picks.splice(k, 1);
    else if (picks.length < maxPick()) picks.push(id);
    else window.toast && toast(`최대 ${maxPick()}마리까지 고를 수 있습니다`);
    renderPick();
  }
  $("gyGrid").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]");
    if (b) toggle(b.dataset.id);
  });
  $("gySlots").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]");
    if (b) toggle(b.dataset.id);
  });

  /* ---------------- 도전 ---------------- */

  $("gyGo").onclick = async () => {
    if (busy || (arena() && arena().busy())) return;
    busy = true;
    updateGo();
    const r = await window.ptb.gymChallenge(sel, picks.slice(0, maxPick()));
    if (!r || !r.ok) {
      busy = false;
      updateGo();
      $("gyNote").className = "gynote bad";
      $("gyNote").textContent = (r && r.reason) || "도전하지 못했습니다";
      return;
    }
    const A = arena();
    A.hold(true);
    try {
      await replay(r, A);
    } finally {
      A.hold(false);
      busy = false;
      if (r.reward && !r.road) sel = null; // 새 배지 — 다음 체육관으로 넘어가 보여 준다
      await load();
    }
  };

  /** 판마다 이어서 튼다. 관장이 다음 아이를 내보내거나 내가 다음 아이를 내보내면 그 말부터 */
  async function replay(r, A) {
    const lead = r.gym.lead || `관장 ${r.gym.name}`;
    const title = r.road ? `🏆 챔피언 로드 ${r.gym.stage} / ${r.gym.total}` : r.weekly ? `🎫 주간 도전 · ${r.gym.name}` : `🏟️ ${r.gym.name} 체육관`;
    for (let k = 0; k < r.rounds.length; k++) {
      const rd = r.rounds[k];
      const prev = r.rounds[k - 1];
      const [me, foe] = rd.fighters;
      const intro = [];
      if (!prev) {
        intro.push(`“${r.gym.intro}”`, `${A.josa(lead, "이", "가")} 승부를 걸어왔다!`, `${A.josa(lead, "은", "는")} ${A.josa(foe.name, "을", "를")} 내보냈다!`, `가랏, ${me.name}!`);
      } else {
        if (rd.b !== prev.b) intro.push(`${A.josa(lead, "은", "는")} ${A.josa(foe.name, "을", "를")} 내보냈다!`);
        if (rd.a !== prev.a) intro.push(`가랏, ${me.name}!`);
        if (!intro.length) intro.push(`${me.name} VS ${foe.name}!`);
      }
      const lastRound = k === r.rounds.length - 1;
      await A.play(rd, {
        title,
        skip: true,
        intro,
        first: !prev,
        end: lastRound ? endOf(r) : false,
        foot: lastRound ? footOf(r) : "",
      });
    }
  }

  function endOf(r) {
    if (r.weekly) {
      if (!r.win) return { cls: "lose", html: `졌다…<small>이번 주 남은 도전 ${r.tries} / ${r.max}</small>`, say: `“${r.gym.lose}”` };
      const got = r.reward;
      return {
        cls: "win",
        html: (got ? `🎫 ${esc(got.token)} 획득!` : "🏆 이겼다!") + `<small>${got ? `증표 ${got.count} / ${got.total} · 🍬${got.candy}` : "이번 주에 이미 받은 증표입니다"}</small>`,
        say: `“${r.gym.win}”`,
      };
    }
    if (r.road) {
      const got = r.reward;
      if (!r.win) return { cls: "lose", html: `졌다…<small>챔피언 로드 남은 도전 ${r.tries} / ${r.max}</small>`, say: `“${r.gym.lose}”` };
      if (got && got.champ) return { cls: "win", html: `🏆 이번 주 챔피언!<small>${got.streak > 1 ? `${got.streak}주 연속 · ` : ""}🍬${got.candy}${got.masterBall ? " · 마스터볼" : ""}</small>`, say: `“${r.gym.win}”` };
      if (got) return { cls: "win", html: `관문 ${got.stage} / ${got.total} 통과!<small>🍬${got.candy} · 다음: ${esc(got.next)}</small>`, say: `“${r.gym.win}”` };
      return { cls: "win", html: `🏆 이겼다!<small>이번 주 보상은 이미 받았습니다</small>`, say: `“${r.gym.win}”` };
    }
    if (r.win) {
      const got = r.reward;
      return {
        cls: "win",
        html: (got ? `🏅 ${esc(got.badge)} 획득!` : "🏆 이겼다!") + `<small>${got ? `배지 ${got.count} / 8 · 🍬${got.candy}` : "이미 딴 배지입니다"}</small>`,
        say: `“${r.gym.win}”`,
      };
    }
    return { cls: "lose", html: `졌다…<small>이번 주 남은 도전 ${r.tries} / ${r.max}</small>`, say: `“${r.gym.lose}”` };
  }

  function footOf(r) {
    if (r.weekly) {
      if (!r.win) return `${r.gym.lead}에게 졌습니다. 이번 주 남은 도전 ${r.tries}번.`;
      const got = r.reward;
      if (!got) return "이번 주에 이미 받은 증표라 보상은 없습니다.";
      if (window.toast) toast(got.road ? "🏆 증표 8개 — 이번 주 챔피언 로드가 열렸습니다!" : `🎫 ${got.token} 획득!`);
      return `${got.token}를 받았다! 사탕 ${got.candy}개를 받았습니다.` + (got.road ? " 증표 8개를 다 모았다 — 이번 주 챔피언 로드가 열렸습니다!" : ` 이번 주 증표 ${got.count} / ${got.total}.`);
    }
    if (r.road) {
      if (!r.win) return `${r.gym.lead}에게 졌습니다. 이번 주 챔피언 로드 남은 도전 ${r.tries}번.`;
      const got = r.reward;
      if (!got) return "이번 주 챔피언 보상은 이미 받았습니다.";
      if (got.champ) {
        if (window.toast) toast(got.masterBall ? "🏆 처음으로 챔피언이 됐습니다 — 마스터볼을 받았습니다!" : "🏆 이번 주 챔피언!");
        return `챔피언이 됐다! 사탕 ${got.candy}개${got.masterBall ? "와 마스터볼 하나" : ""}를 받았습니다.${got.streak > 1 ? ` ${got.streak}주 연속 챔피언!` : ""}`;
      }
      if (window.toast) toast(`관문 ${got.stage} 통과 — 다음은 ${got.next}`);
      return `관문 ${got.stage}을 넘었다! 사탕 ${got.candy}개를 받았습니다. 다음은 ${got.next}.`;
    }
    if (!r.win) return `${r.gym.name} 체육관에서 졌습니다. 이번 주 남은 도전 ${r.tries}번.`;
    if (!r.reward) return "이미 딴 배지라 보상은 없습니다.";
    let t = `${r.reward.badge}를 받았다! 사탕 ${r.reward.candy}개를 받았습니다.`;
    if (r.reward.legend) t += " 배지 8개를 다 모았다 — 전설의 알이 박스에 들어왔습니다! 배틀 탭에 🎫 주간 도전이 열렸습니다.";
    if (window.toast) toast(r.reward.legend ? "🥚 배지 8개 — 전설의 알을 받았습니다!" : `🏅 ${r.reward.badge} 획득!`);
    return t;
  }

  // 배틀 탭은 체육관부터 연다
  load();
})();
