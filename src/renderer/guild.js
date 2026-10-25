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
          <span class="nm">${i === 0 && r.week > 0 ? "👑 " : ""}${esc(r.m.trainer)}</span>
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
    renderRank(g, rk);
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
        guildName: g.name,
        count: g.members.length,
        notice: rk.top ? `${rk.top.m.trainer} ${fmt(rk.top.week)}` : "",
        // 이번 주 1위의 포켓몬은 왕관을 쓰고 다닌다
        mons: g.members
          .filter((m) => m.room.mons[0])
          .map((m) => ({ ...m.room.mons[0], id: "hall:" + m.id, owner: m.trainer, badge: (rk.top && rk.top.m.id === m.id ? "👑 " : "") + m.trainer, me: m.me })),
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
    const r = await window.ptb.guildCreate({ name: $("gdName").value, trainer: $("gdTrainer").value });
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
    if (before !== now) { guild = null; visiting = null; } // 들어가거나 나갔다
    if (view === "guild") show(false);
  });
})();
