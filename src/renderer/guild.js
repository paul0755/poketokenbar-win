"use strict";
/**
 * 길드 — 방 탭의 "길드" 쪽. 길드원의 방을 구경하고, 길드원과 바로 결투한다.
 *
 * 서버와 이야기하는 건 메인(index.js 길드 칸)이 한다. 여기서는 받은 길드를 그린다.
 *
 * 처음엔 길드 홀 — 방과 다른 곳이다. 길드원마다 대표 포켓몬(그 사람 방의 첫 아이)이
 * 트레이너 이름표를 달고 모인다. "방 구경"을 누르면 그 사람의 방으로 들어간다.
 * 홀도 방도 room.js(window.ptbRoom)가 그린다 — 받은 방 사진을 같은 꼴로 넘기기만 한다.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  let last = null; // 마지막 갱신
  let view = "mine";
  let guild = null; // 마지막으로 받은 길드
  let visiting = null; // 방을 구경하는 길드원. null 이면 길드 홀
  let loading = false;
  let room = null;

  /** 이번 주(월요일 0시 시작)와 오늘 — 메인 weekUsage 와 같은 꼴 */
  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function keysNow() {
    const now = new Date();
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return { week: dayKey(monday), day: dayKey(now) };
  }

  /**
   * 이번 주 토큰 순위. 지난주에 마지막으로 올린 사람은 이번 주 0 으로 친다(weekKey 가 다르다).
   * 공개를 끈 사람은 순위에서 빠지고 아래에 이름만 남는다.
   */
  function ranking(g) {
    const k = keysNow();
    const rows = g.members.map((m) => {
      const u = m.usage;
      const thisWeek = u && u.weekKey === k.week;
      return { m, hidden: !u, week: thisWeek ? u.week : 0, burn: thisWeek ? u.burn : 0, today: u && u.dayKey === k.day ? u.today : 0 };
    });
    const ranked = rows.filter((r) => !r.hidden).sort((a, b) => b.week - a.week);
    const best = (key) => ranked.reduce((a, r) => (r[key] > (a ? a[key] : 0) ? r : a), null);
    return {
      ranked,
      hidden: rows.filter((r) => r.hidden).map((r) => r.m),
      total: ranked.reduce((n, r) => n + r.week, 0),
      top: ranked[0] && ranked[0].week > 0 ? ranked[0] : null,
      todayTop: best("today"),
      burnTop: best("burn"),
    };
  }

  function renderRank(g, rk) {
    const max = rk.ranked.length ? Math.max(1, rk.ranked[0].week) : 1;
    const rows = rk.ranked
      .map((r, i) => `<div class="row${r.m.me ? " me" : ""}">
          <span class="no">${i + 1}</span>
          <span class="nm">${esc(r.m.trainer)}${rk.icons && rk.icons(r.m.id) ? ` <i class="tt" title="지난주 칭호">${rk.icons(r.m.id)}</i>` : ""}</span>
          <span class="bar"><i style="width:${Math.round((r.week / max) * 100)}%"></i><i class="b" style="width:${Math.round((r.burn / max) * 100)}%"></i></span>
          <span class="v">${fmt(r.week)}</span>
          <span class="sub">오늘 ${fmt(r.today)}${r.burn ? ` · 🔥 ${fmt(r.burn)}` : ""}</span>
        </div>`)
      .join("");
    const extra = [
      rk.todayTop && rk.todayTop.today > 0 ? `오늘 1위 <b>${esc(rk.todayTop.m.trainer)}</b> ${fmt(rk.todayTop.today)}` : "",
      rk.burnTop && rk.burnTop.burn > 0 ? `🔥 버닝타임 MVP <b>${esc(rk.burnTop.m.trainer)}</b> ${fmt(rk.burnTop.burn)}` : "",
      rk.hidden.length ? `비공개 ${rk.hidden.map((m) => esc(m.trainer)).join(", ")}` : "",
    ].filter(Boolean).join(" · ");
    $("gdRank").innerHTML = `
      <div class="hd"><b>📊 이번 주 토큰 순위</b><span>길드 합계 <b>${fmt(rk.total)}</b></span></div>
      ${rows || '<div class="sub">아직 공개한 길드원이 없습니다</div>'}
      ${extra ? `<div class="ft">${extra}</div>` : ""}
      <div class="ft dim">월요일 0시부터. 길드원의 앱이 켜져 있을 때 몇 분마다 올라갑니다. 막대의 주황 몫은 버닝타임에 쓴 토큰</div>`;
  }

  /* ---------------- 칭호 · 명예의 전당 ----------------
     끝난 주(이번 주보다 앞)의 기록으로 정한다. 시간대는 버닝타임 설정과 상관없이 고정이다. */

  const TITLES = [
    { k: "week", icon: "👑", name: "토큰왕" },
    { k: "burn", icon: "🔥", name: "버닝 MVP" },
    { k: "core", icon: "☀️", name: "코어타임 장인" },
    { k: "night", icon: "🌙", name: "야근왕" },
    { k: "dawn", icon: "🦉", name: "올빼미" },
    { k: "morning", icon: "🌅", name: "아침형" },
  ];

  /** 그 주의 칭호마다 1위 — 0 이면 없음 */
  function titlesOf(wk) {
    return TITLES.map((t) => {
      const best = (wk.rows || []).reduce((a, r) => ((r[t.k] || 0) > (a ? a[t.k] || 0 : 0) ? r : a), null);
      return best ? { ...t, id: best.id, trainer: best.trainer, value: best[t.k] } : null;
    }).filter(Boolean);
  }

  /** "10월 3주차" · "10/13~10/19" */
  function weekLabel(key) {
    const [y, m, d] = key.split("-").map(Number);
    const mon = new Date(y, m - 1, d);
    const sun = new Date(y, m - 1, d + 6);
    return { name: `${mon.getMonth() + 1}월 ${Math.ceil(mon.getDate() / 7)}주차`, range: `${mon.getMonth() + 1}/${mon.getDate()}~${sun.getMonth() + 1}/${sun.getDate()}` };
  }

  let hofAll = false; // 명예의 전당 더 보기

  function renderHof(g, closed) {
    if (!closed.length) {
      $("gdHof").innerHTML = `<div class="hd"><b>🏛️ 명예의 전당</b></div><div class="sub">한 주가 끝나면 그 주의 1위와 칭호가 여기 남습니다. 월요일 0시에 주가 바뀝니다.</div>`;
      return;
    }
    const pic = (id) => { const m = g.members.find((x) => x.id === id); const mon = m && m.room.mons[0]; return mon && mon.url ? `<img src="${esc(mon.url)}" alt="">` : ""; };
    const wins = {};
    for (const wk of closed) { const t = titlesOf(wk)[0]; if (t && t.k === "week") wins[t.trainer] = (wins[t.trainer] || 0) + 1; }
    const tally = Object.entries(wins).sort((a, b) => b[1] - a[1]).map(([n, c]) => `<b>${esc(n)}</b> ${c}회`).join(" · ");
    const list = hofAll ? closed : closed.slice(0, 4);
    $("gdHof").innerHTML = `
      <div class="hd"><b>🏛️ 명예의 전당</b><span>지난 ${closed.length}주</span></div>
      ${tally ? `<div class="tot">👑 주간 1위 — ${tally}</div>` : ""}
      ${list.map((wk) => {
        const ts = titlesOf(wk);
        const top = ts.find((t) => t.k === "week");
        const L = weekLabel(wk.key);
        return `<div class="wk">
          <div class="when">${L.name}<span>${L.range}</span></div>
          <div class="pic">${top ? pic(top.id) : ""}</div>
          <div class="win">${top ? `<b>👑 ${esc(top.trainer)}</b><span>${fmt(top.value)}</span>` : '<span>기록 없음</span>'}</div>
          <div class="chips">${ts.filter((t) => t.k !== "week").map((t) => `<span title="${t.name} ${fmt(t.value)}">${t.icon} ${esc(t.trainer)}</span>`).join("")}</div>
        </div>`;
      }).join("")}
      ${closed.length > 4 ? `<button class="mini2 more" id="gdHofMore">${hofAll ? "접기" : `더 보기 (${closed.length - 4}주)`}</button>` : ""}
      <div class="ft dim">${TITLES.map((t) => `${t.icon} ${t.name}`).join(" · ")} — 칭호는 한 주 동안 이름표에 달립니다. 아침 6~10시 · 코어 10~16시 · 야근 18~24시 · 올빼미 0~6시</div>`;
  }

  const ago = (ms) => {
    const m = Math.round((Date.now() - ms) / 60000);
    return m < 1 ? "방금" : m < 60 ? m + "분 전" : m < 1440 ? Math.round(m / 60) + "시간 전" : Math.round(m / 1440) + "일 전";
  };

  /* ---------------- 내 방 · 길드 바꾸기 ---------------- */

  $("rmSwitch").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]");
    if (!b) return;
    view = b.dataset.view;
    for (const x of $("rmSwitch").querySelectorAll("button")) x.classList.toggle("on", x === b);
    $("rmMineView").hidden = view !== "mine";
    $("gdView").hidden = view !== "guild";
    if (view === "guild") show(true);
  });

  /** 지금 상태에 맞는 칸만 보인다. fetch 면 길드를 다시 받아 온다 */
  function show(fetch = false) {
    const s = last;
    if (!s) return;
    const online = Boolean(s.online && s.online.enabled);
    const g = s.guild;
    $("gdOff").hidden = online;
    $("gdGone").hidden = !(online && g && g.gone);
    $("gdNone").hidden = !(online && !g);
    $("gdIn").hidden = !(online && g && !g.gone);
    if (g && g.gone) $("gdGoneMsg").textContent = g.gone;
    if (online && !g && !$("gdTrainer").value) $("gdTrainer").value = (s.friend && s.friend.trainer) || "";
    if (online && !g && fetch) loadList(); // 길드가 없으면 목록부터 보여 준다
    if (online && g && !g.gone) {
      $("gdTitle").textContent = g.name;
      $("gdCopy").textContent = "GLD-" + g.code;
      if (fetch || !guild) load();
    }
  }

  async function load() {
    if (loading) return;
    loading = true;
    $("gdRefresh").disabled = true;
    try {
      const r = await window.ptb.guildView();
      if (!r || !r.ok) {
        if (!(r && r.gone)) toast((r && r.reason) || "길드를 불러오지 못했습니다", "bad");
        return;
      }
      guild = r;
      if (visiting && !r.members.some((m) => m.id === visiting)) visiting = null; // 그 사이 나갔다
      if (r.medal) toast("🏅 지난주 길드 1위! 내 방에 메달 액자가 걸렸습니다", "shiny");
      else if (r.goalNew) toast(`🎉 지난주 길드 목표 ${MEDAL[r.goalNew.reached - 1]} 달성! 그 주에 쓴 길드원에게 🪙${r.goalNew.coins}씩`, "shiny");
      renderGuild();
    } finally {
      loading = false;
      $("gdRefresh").disabled = false;
    }
  }

  function renderGuild() {
    const g = guild;
    $("gdTitle").textContent = g.name;
    $("gdCount").textContent = `${g.members.length}/${g.max}명${g.leader ? " · 길드장" : ""}`;
    const rk = ranking(g);
    // 끝난 주들 — 지난주 칭호는 한 주 동안 이름표에 달고 다닌다
    const closed = (g.weeks || []).filter((w) => w.key < keysNow().week);
    const lastTitles = closed[0] ? titlesOf(closed[0]) : [];
    const iconsOf = (id) => lastTitles.filter((t) => t.id === id).map((t) => t.icon).join("");
    rk.icons = iconsOf;
    renderRank(g, rk);
    renderHof(g, closed);
    renderGoal(g, rk);
    renderHall(g);
    renderListing(g);
    $("gdShare").checked = Boolean(last && last.guild && last.guild.share);
    const sel = visiting && g.members.find((m) => m.id === visiting);
    if (!room) room = window.ptbRoom.create($("gdRoom"));
    if (sel) {
      // 길드원의 방 — 이름표는 "친구의 핫삼"
      room.setEmpty(sel.me ? "내 방에 둔 포켓몬이 없습니다" : "이 길드원은 방에 포켓몬을 두지 않았습니다");
      room.render({ ...sel.room, trainer: sel.trainer, mons: sel.room.mons.map((x) => ({ ...x, owner: sel.me ? null : sel.trainer })) });
      $("gdVisit").innerHTML = `<button class="mini2" id="gdBack">← 길드 홀</button><span>${sel.me ? "내 방 — 길드원에게 이렇게 보입니다" : `${esc(sel.trainer)}의 방 · ${ago(sel.updated)} 올림`}</span>`;
    } else {
      // 길드 홀 — 길드원마다 대표 포켓몬 한 마리가 트레이너 이름표를 달고 모인다
      room.setEmpty("방에 포켓몬을 둔 길드원이 없습니다");
      room.render({
        kind: "hall",
        code: g.code,
        hall: {
          owned: g.hall.owned,
          theme: g.hall.theme,
          // 트로피 진열장 — 목표 🥇를 이룬 주의 수
          golds: (g.weeks || []).filter((w) => w.goal && w.goal.reached >= 3).length,
          // 마스코트 석상 — 지난주 1위의 대표 포켓몬(그 사람 방의 첫 아이)
          mascot: (() => {
            const t = lastTitles.find((x) => x.k === "week");
            const m = t && g.members.find((x) => x.id === t.id);
            return (m && m.room.mons[0] && m.room.mons[0].dexId) || null;
          })(),
        },
        goal: g.goal,
        guildName: g.name,
        count: g.members.length,
        // 게시판 — 지난주 1위가 있으면 그 사람, 없으면 이번 주 지금 1위
        notice: (() => {
          const t = lastTitles.find((x) => x.k === "week");
          if (t) return `지난주 1위 · ${t.trainer} ${fmt(t.value)}`;
          return rk.top ? `이번 주 1위 · ${rk.top.m.trainer} ${fmt(rk.top.week)}` : "";
        })(),
        // 지난주 칭호를 이름표에 달고 다닌다 (👑🌙 예잔디)
        mons: g.members
          .filter((m) => m.room.mons[0])
          .map((m) => ({ ...m.room.mons[0], id: "hall:" + m.id, owner: m.trainer, badge: (iconsOf(m.id) ? iconsOf(m.id) + " " : "") + m.trainer, me: m.me })),
      });
      $("gdVisit").innerHTML = "<span>길드 홀 — 길드원마다 대표 포켓몬(그 사람 방의 첫 아이)이 모여 있습니다. 길드원을 누르면 그 방으로 갑니다</span>";
    }

    $("gdMembers").innerHTML = g.members
      .map((m) => {
        const pic = (m.room.mons[0] || {}).url;
        return `<div class="gd-m${sel && m.id === sel.id ? " on" : ""}" data-id="${esc(m.id)}">
          <div class="pic">${pic ? `<img src="${esc(pic)}" alt="">` : ""}</div>
          <div class="t"><b>${esc(m.trainer)}</b>${m.leader ? ' <span class="ld">길드장</span>' : ""}${m.me ? ' <span class="me">나</span>' : ""}
            <span>도감 ${m.room.dex.seen} · 졸업 ${m.room.graduated} · ${m.room.wins}승 · ${ago(m.updated)}</span></div>
          <div class="acts">
            <button data-visit>방 구경</button>
            ${m.me ? "" : `<button data-battle ${m.canBattle ? "" : 'disabled title="아직 대표 포켓몬을 올리지 않았습니다"'}>결투</button>`}
            ${g.leader && !m.me ? '<button data-kick class="del">내보내기</button>' : ""}
          </div>
        </div>`;
      })
      .join("");
  }

  /* ---------------- 공동 목표 ---------------- */

  const MEDAL = ["🥉", "🥈", "🥇"];
  /** 이번 주 길드 합계와 목표 셋 — 공개한 사람만 센다(서버도 그렇게 센다) */
  function renderGoal(g, rk) {
    const el = $("gdGoal");
    const goal = g.goal;
    el.hidden = !goal;
    if (!goal) return;
    const [t1, , t3] = goal.tiers;
    const total = goal.total;
    const at = (v) => Math.min(100, (v / t3) * 100);
    const next = goal.tiers.findIndex((t) => total < t);
    const shared = g.members.filter((m) => m.usage).length;
    const coins = g.goalCoins || [10, 20, 35];
    const foot = next < 0
      ? `<b>🥇 달성!</b> — 일요일 밤까지 쓴 길드원 모두 🪙${coins[2]}`
      : `${goal.reached ? `${MEDAL[goal.reached - 1]} 달성 · ` : ""}<b>${MEDAL[next]}까지 ${fmt(goal.tiers[next] - total)} 남음</b> — 이루면 이번 주에 쓴 길드원 모두 🪙${coins[next]}`;
    el.innerHTML = `<div class="top"><b>🎯 이번 주 길드 목표</b><span>공개한 길드원 ${shared}명 · 합계 ${fmt(total)}${next >= 0 ? ` / ${MEDAL[next]} ${fmt(goal.tiers[next])}` : ""}</span></div>
      <div class="bar"><div class="fill" style="width:${at(total)}%"></div>${goal.tiers.map((t) => `<i class="tick" style="left:${at(t)}%"></i>`).join("")}</div>
      <div class="labs">${goal.tiers.map((t, i) => `<span class="${total >= t ? "done" : ""}" style="left:${at(t)}%">${MEDAL[i]} 🪙${coins[i]}</span>`).join("")}</div>
      <div class="foot">${foot}${g.walletOk ? "" : ` · <span class="warn">코인 보상은 내 지갑이 확인되면 들어갑니다</span>`}</div>`;
    el.title = `목표는 이 길드의 최근 4주 평균으로 정해집니다(🥉 ${fmt(t1)} · 🥈 ${fmt(goal.tiers[1])} · 🥇 ${fmt(t3)}). 합계는 순위를 공개한 사람만 셉니다`;
  }

  /* ---------------- 홀 꾸미기 (모금) ---------------- */

  function renderHall(g) {
    const h = g.hall;
    const items = g.hallItems || [];
    const themes = items.filter((it) => it.theme && h.owned.includes(it.id));
    const pick = (id, name) => `<button data-theme="${id}" class="${(h.theme || "stone") === id ? "on" : ""}" ${g.leader ? "" : "disabled"}>${name}</button>`;
    $("gdHall").innerHTML = `<div class="hd"><b>🏗️ 홀 꾸미기</b><span>길드원이 함께 모금 · 다 모이면 홀에 놓인다 · 내 코인 <b>🪙${g.coins == null ? "–" : g.coins}</b></span></div>
      ${themes.length ? `<div class="themes">${pick("stone", "🪨 돌 홀")}${themes.map((t) => pick(t.id, `${t.icon} ${t.name.replace("홀 배경: ", "")}`)).join("")}${g.leader ? "" : '<span class="sub">홀 배경은 길드장이 고릅니다</span>'}</div>` : ""}
      <div class="fund">${items.map((it) => {
        const have = h.funds[it.id] || 0;
        const done = h.owned.includes(it.id);
        const who = (h.donors[it.id] || []).map((d) => `${esc(d.trainer)} ${d.coins}`).join(" · ");
        return `<div class="it${done ? " done" : ""}" data-item="${it.id}">
          <div class="nm">${it.icon} ${esc(it.name)}<span>🪙${it.coins}</span></div>
          <div class="ds">${esc(it.desc)}</div>
          <div class="pb"><i style="width:${Math.min(100, (have / it.coins) * 100)}%"></i></div>
          <div class="amt">${done ? '<span class="ok">✓ 완성 · 홀에 놓였다</span>' : `<span><b>🪙${have}</b> / 🪙${it.coins}</span><span>${Math.floor((have / it.coins) * 100)}%</span>`}</div>
          ${done ? "" : `<div class="btns"><button data-give="10">+🪙10</button><button data-give="50">+🪙50</button><input type="number" min="1" placeholder="직접"><button data-give="in">넣기</button></div>`}
          <div class="who">${who ? "보탠 사람 · " + who : "아직 아무도 안 보탰다"}</div>
        </div>`;
      }).join("")}</div>
      <div class="ft dim">넣은 코인은 돌려받지 않습니다(길드를 나가도 길드에 남습니다). 남은 금액보다 많이 넣으면 남은 만큼만 빠집니다</div>`;
  }

  $("gdHall").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled || !guild) return;
    if (b.dataset.theme) {
      if (done(await window.ptb.hallTheme(b.dataset.theme))) load();
      return;
    }
    const card = b.closest("[data-item]");
    if (!card || !b.dataset.give) return;
    const amount = b.dataset.give === "in" ? Math.floor(Number(card.querySelector("input").value) || 0) : Number(b.dataset.give);
    if (amount < 1) return toast("넣을 코인을 적어 주세요", "bad");
    if (amount >= 50 && !sure(b, `🪙${amount} 정말?`)) return; // 큰 돈은 한 번 더
    b.disabled = true;
    const r = await window.ptb.hallDonate({ item: card.dataset.item, amount });
    b.disabled = false;
    if (done(r)) load();
  });

  /* ---------------- 길드 목록 ---------------- */

  let found = null; // 마지막으로 받은 목록 { guilds, at }
  let finding = false;

  /** 목록을 받아 온다. 1분 안에 받은 게 있으면 그대로 쓴다(force 면 다시) */
  async function loadList(force = false) {
    if (finding) return;
    if (!force && found && Date.now() - found.at < 60_000) return renderList();
    finding = true;
    $("gdFindRe").disabled = true;
    if (!found) $("gdList").innerHTML = '<div class="empty">길드 목록을 불러오는 중…</div>';
    try {
      const r = await window.ptb.guildList();
      if (!r || !r.ok) {
        found = null;
        $("gdList").innerHTML = `<div class="empty">${esc((r && r.reason) || "길드 목록을 불러오지 못했습니다")}</div>`;
        return;
      }
      found = { guilds: r.guilds, at: Date.now() };
      renderList();
    } finally {
      finding = false;
      $("gdFindRe").disabled = false;
    }
  }

  function renderList() {
    if (!found) return;
    const q = $("gdFindQ").value.trim().toLowerCase();
    const list = found.guilds.filter((x) => !q || (x.name + " " + (x.intro || "") + " " + (x.leader || "")).toLowerCase().includes(q));
    if (!found.guilds.length) {
      $("gdList").innerHTML = '<div class="empty">아직 목록에 올라온 길드가 없습니다.<br>아래에서 길드를 만들어 첫 길드가 되어 보세요</div>';
      return;
    }
    if (!list.length) {
      $("gdList").innerHTML = `<div class="empty">"${esc(q)}"(이)가 들어간 길드가 없습니다</div>`;
      return;
    }
    $("gdList").innerHTML = list.map((x) => {
      const full = x.members >= x.max;
      return `<div class="g${full ? " full" : ""}" data-code="${esc(x.code)}">
        <div class="tx">
          <div class="nm">${esc(x.name)}<span>👥 ${x.members}/${x.max}</span></div>
          ${x.intro ? `<div class="in">${esc(x.intro)}</div>` : ""}
          <div class="mt">${x.active ? `<span class="hot">이번 주 ${x.active}명 활동</span> · ` : ""}길드장 ${esc(x.leader || "–")}${x.hall ? ` · 🏗️ 홀 장식 ${x.hall}` : ""} · ${ago(x.at)} 움직임</div>
        </div>
        <button class="mini2" data-join ${full ? "disabled" : ""}>${full ? "꽉 참" : "들어가기"}</button>
      </div>`;
    }).join("");
  }

  $("gdList").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-join]");
    if (!b || b.disabled) return;
    const row = b.closest("[data-code]");
    if (!$("gdTrainer").value.trim()) {
      toast("먼저 위에 트레이너 이름을 넣어 주세요", "bad");
      $("gdTrainer").focus();
      return;
    }
    b.disabled = true;
    const r = await window.ptb.guildJoin({ code: row.dataset.code, trainer: $("gdTrainer").value });
    b.disabled = false;
    if (done(r)) { guild = null; visiting = null; found = null; }
    else loadList(true); // 그 사이 꽉 찼거나 없어졌을 수 있다
  });
  $("gdFindQ").addEventListener("input", () => renderList());
  $("gdFindRe").onclick = () => loadList(true);

  /** 들어간 길드 — 길드장만 목록에 올리기 · 소개를 바꾼다 */
  function renderListing(g) {
    $("gdListing").hidden = !g.leader;
    if (!g.leader) return;
    $("gdListed").checked = g.listed;
    if (document.activeElement !== $("gdIntro")) $("gdIntro").value = g.intro || "";
    $("gdListingNote").textContent = g.listed
      ? "목록에 올라 있습니다 — 코드를 몰라도 누구나 목록에서 찾아 들어옵니다. 낯선 길드원은 내보낼 수 있습니다"
      : "목록에 없습니다 — 길드 코드를 아는 사람만 들어옵니다";
  }
  const saveListing = async () => {
    $("gdListingOk").disabled = true;
    const r = await window.ptb.guildListing({ listed: $("gdListed").checked, intro: $("gdIntro").value });
    $("gdListingOk").disabled = false;
    if (done(r) && guild) { guild.listed = r.listed; guild.intro = r.intro; renderListing(guild); }
    else if (guild) renderListing(guild);
  };
  $("gdListed").onchange = saveListing;
  $("gdListingOk").onclick = saveListing;
  $("gdIntro").addEventListener("keydown", (e) => { if (e.key === "Enter") saveListing(); });

  /* ---------------- 누르기 ---------------- */

  const done = (r) => {
    if (!r || !r.ok) toast((r && r.reason) || "하지 못했습니다", "bad");
    else if (r.message) toast(r.message);
    return r && r.ok;
  };

  /** 한 번 더 눌러야 실행 — 되돌릴 수 없는 버튼 */
  function sure(btn, label) {
    if (btn.dataset.sure === "1") return true;
    btn.dataset.sure = "1";
    const was = btn.textContent;
    btn.textContent = label;
    setTimeout(() => {
      if (!btn.isConnected) return;
      btn.dataset.sure = "";
      btn.textContent = was;
    }, 3000);
    return false;
  }

  $("gdMembers").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    const card = e.target.closest(".gd-m");
    if (!card || !guild) return;
    const id = card.dataset.id;
    if (!b || b.hasAttribute("data-visit")) {
      visiting = id;
      renderGuild();
      $("gdRoom").scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (b.disabled) return;
    if (b.hasAttribute("data-battle")) {
      b.disabled = true;
      const r = await window.ptbGuildBattle(id);
      b.disabled = false;
      if (r && !r.ok) toast(r.reason || "결투를 시작하지 못했습니다", "bad");
      return;
    }
    if (b.hasAttribute("data-kick")) {
      if (!sure(b, "정말?")) return;
      if (done(await window.ptb.guildKick(id))) load();
    }
  });

  $("gdCreate").onclick = async () => {
    $("gdCreate").disabled = true;
    const r = await window.ptb.guildCreate({ name: $("gdName").value, trainer: $("gdTrainer").value, listed: $("gdPublic").checked });
    $("gdCreate").disabled = false;
    if (done(r)) { guild = null; visiting = null; }
  };
  $("gdJoin").onclick = async () => {
    $("gdJoin").disabled = true;
    const r = await window.ptb.guildJoin({ code: $("gdCode").value, trainer: $("gdTrainer").value });
    $("gdJoin").disabled = false;
    if (done(r)) { guild = null; visiting = null; }
  };
  $("gdLeave").onclick = async () => {
    if (!sure($("gdLeave"), "정말 나가기")) return;
    if (done(await window.ptb.guildLeave())) { guild = null; visiting = null; }
  };
  $("gdGoneOk").onclick = async () => {
    await window.ptb.guildLeave();
    guild = null;
    visiting = null;
  };
  $("gdRefresh").onclick = () => load();
  // 내 이름 바꾸기 — 길드원 목록 · 순위 · 홀 이름표에 바로 바뀐 이름이 뜬다
  const renameRow = (on) => {
    $("gdRenameRow").hidden = !on;
    if (!on) return;
    $("gdRenameIn").value = (last && last.friend && last.friend.trainer) || "";
    $("gdRenameIn").focus();
    $("gdRenameIn").select();
  };
  $("gdRename").onclick = () => renameRow($("gdRenameRow").hidden);
  $("gdRenameNo").onclick = () => renameRow(false);
  $("gdRenameOk").onclick = async () => {
    $("gdRenameOk").disabled = true;
    const r = await window.ptb.guildRename($("gdRenameIn").value);
    $("gdRenameOk").disabled = false;
    if (done(r)) { renameRow(false); load(); }
  };
  $("gdRenameIn").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("gdRenameOk").click();
    if (e.key === "Escape") renameRow(false);
  });
  $("gdHof").addEventListener("click", (e) => {
    if (!e.target.closest("#gdHofMore") || !guild) return;
    hofAll = !hofAll;
    renderGuild();
  });
  $("gdShare").onchange = async () => {
    done(await window.ptb.guildShare($("gdShare").checked));
    load(); // 바로 올렸으니 순위도 다시 받는다
  };
  $("gdVisit").addEventListener("click", (e) => {
    if (!e.target.closest("#gdBack")) return;
    visiting = null;
    renderGuild();
  });
  $("gdOpenSettings").onclick = () => window.ptb.openSettings();
  $("gdCopy").onclick = async () => {
    try { await navigator.clipboard.writeText($("gdCopy").textContent); } catch {}
    toast("길드 코드를 복사했습니다. 친구에게 알려 주세요");
  };

  // 길드 화면을 보고 있으면 2분마다 다시 받아 온다 — 길드원이 방을 바꿨을 수 있다
  setInterval(() => {
    if (view === "guild" && !$("tab-room").hidden && last && last.guild && !last.guild.gone) load();
  }, 120_000);

  window.ptb.onStats((s) => {
    const before = last && last.guild ? last.guild.code + (last.guild.gone || "") : "";
    last = s;
    const now = s.guild ? s.guild.code + (s.guild.gone || "") : "";
    const moved = before !== now; // 들어가거나 나갔다 — 나갔으면 길드 목록을 다시 받는다
    if (moved) { guild = null; visiting = null; found = null; }
    if (view === "guild") show(moved);
  });
})();
