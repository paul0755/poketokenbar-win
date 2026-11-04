"use strict";
/**
 * 체육관 — 배틀 탭의 첫 칸. 배지 케이스 · 관장 카드 · 내 팀 고르기 · 도전.
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
  let sel = null; // 보고 있는 체육관 id
  let picks = []; // 고른 내 아이 id — 고른 순서대로 나간다
  let last = null; // 마지막 갱신(박스)
  let busy = false;

  const fighters = (s) => (s && s.box ? s.box.filter((m) => m.stageKey !== "egg" && m.profile) : []);

  /** 처음 볼 체육관 — 아직 못 딴 것 중 열린 첫 곳. 다 땄으면 마지막 */
  const firstOpen = (d) => (d.gyms.find((g) => g.open && !g.got) || d.gyms[d.gyms.length - 1]).id;

  async function load() {
    const d = await window.ptb.gymList();
    if (!d) return;
    data = d;
    if (!sel || !d.gyms.some((g) => g.id === sel)) sel = firstOpen(d);
    render();
  }
  window.ptbGymOpen = load;

  window.ptb.onStats((s) => {
    if (!s || !s.box) return;
    last = s;
    // 놓아주거나 알로 돌아간 아이는 뺀다. 처음이면 키우는 아이와 레벨 높은 순으로 채운다
    const ok = new Set(fighters(s).map((m) => m.id));
    picks = picks.filter((id) => ok.has(id));
    if (!picks.length && !busy) picks = defaultPicks(s);
    if (data) renderPick();
  });

  function defaultPicks(s) {
    const list = fighters(s).slice().sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || b.profile.level - a.profile.level);
    return list.slice(0, 3).map((m) => m.id);
  }

  /* ---------------- 그리기 ---------------- */

  function render() {
    if (!data) return;
    $("gyCount").textContent = `${data.badges} / ${data.gyms.length}`;
    $("gyTries").textContent = `이번 주 남은 도전 ${data.tries} / ${data.max}`;
    $("gyTries").classList.toggle("out", data.tries <= 0);
    $("gyBadges").innerHTML = data.gyms
      .map((g) => `<button data-id="${g.id}" class="${g.id === sel ? "on" : ""}${g.got ? " got" : ""}${g.open ? "" : " lock"}" title="${esc(g.badge)} — ${esc(g.name)}">
          ${art().badge(g.id, g.got, 34)}<span>${g.n + 1}</span></button>`)
      .join("");
    renderCard();
    renderPick();
  }

  function renderCard() {
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
    $("gySlots").innerHTML = [0, 1, 2]
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

  /* ---------------- 고르기 ---------------- */

  $("gyBadges").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]");
    if (!b || busy) return;
    sel = b.dataset.id;
    render();
  });

  function toggle(id) {
    if (busy) return;
    const k = picks.indexOf(id);
    if (k >= 0) picks.splice(k, 1);
    else if (picks.length < 3) picks.push(id);
    else window.toast && toast("최대 3마리까지 고를 수 있습니다");
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
    const r = await window.ptb.gymChallenge(sel, picks);
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
      if (r.reward) sel = null; // 새 배지 — 다음 체육관으로 넘어가 보여 준다
      await load();
    }
  };

  /** 판마다 이어서 튼다. 관장이 다음 아이를 내보내거나 내가 다음 아이를 내보내면 그 말부터 */
  async function replay(r, A) {
    const lead = `관장 ${r.gym.name}`;
    const title = `🏟️ ${r.gym.name} 체육관`;
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
    if (!r.win) return `${r.gym.name} 체육관에서 졌습니다. 이번 주 남은 도전 ${r.tries}번.`;
    if (!r.reward) return "이미 딴 배지라 보상은 없습니다.";
    let t = `${r.reward.badge}를 받았다! 사탕 ${r.reward.candy}개를 받았습니다.`;
    if (r.reward.legend) t += " 배지 8개를 다 모았다 — 전설의 알이 박스에 들어왔습니다!";
    if (window.toast) toast(r.reward.legend ? "🥚 배지 8개 — 전설의 알을 받았습니다!" : `🏅 ${r.reward.badge} 획득!`);
    return t;
  }

  // 배틀 탭은 체육관부터 연다
  load();
})();
