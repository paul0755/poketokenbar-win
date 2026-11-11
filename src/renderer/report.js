"use strict";
/**
 * 📊 주간 리포트 — 홈의 "이번 주" 옆 버튼으로 연다. 한 주를 카드 한 장으로(main/report.js).
 * ◀ ▶ 로 지난 주들을 넘겨 본다. 새 지난 주 리포트가 나오면 버튼에 점이 붙는다.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
  let keys = [];
  let key = null;

  /** 1.2억 · 3,400만 · 5,600 — 리포트는 한국어 단위로 읽힌다 */
  function num(n) {
    n = Math.round(n || 0);
    if (n >= 1e8) return (n / 1e8).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, "") + "억";
    if (n >= 1e4) return Math.round(n / 1e4).toLocaleString("ko-KR") + "만";
    return n.toLocaleString("ko-KR");
  }
  const pct = (x) => Math.round((x || 0) * 100) + "%";
  const cuR = () => (window.ptbCur ? window.ptbCur() : { name: "사탕", icon: "🍬", time: "사탕 타임" }); // 🍬 사탕 · 💠 비트

  /** "11월 2일 – 8일" · 달이 넘어가면 "10월 27일 – 11월 2일" */
  function rangeLabel(k) {
    const [y, m, d] = k.split("-").map(Number);
    const a = new Date(y, m - 1, d);
    const b = new Date(y, m - 1, d + 6);
    const A = `${a.getMonth() + 1}월 ${a.getDate()}일`;
    return a.getMonth() === b.getMonth() ? `${A} – ${b.getDate()}일` : `${A} – ${b.getMonth() + 1}월 ${b.getDate()}일`;
  }

  /** 가장 많이 쓴 두 시간 — 이웃한 두 칸의 합이 가장 큰 곳 */
  function peakHours(h) {
    let best = -1, at = 0;
    for (let i = 0; i < 24; i++) {
      const v = h[i] + h[(i + 1) % 24];
      if (v > best) { best = v; at = i; }
    }
    return best > 0 ? at : null;
  }
  /** 두 시간 칸 이름 — "오후 1~3시" · "밤 10~12시" · "새벽 0~2시" */
  const h12 = (h) => (h % 12 === 0 && h ? 12 : h % 12);
  const hourName = (h) => (h < 6 ? "새벽" : h < 12 ? "오전" : h < 18 ? "오후" : "밤") + ` ${h < 6 ? h : h12(h)}~${h < 6 ? h + 2 : h12(h + 2)}시`;

  /** 맨 위 한 줄 — 지난 주와 견주기, 아니면 가장 눈에 띄는 것 */
  function headline(r) {
    if (!r.total) return r.current ? "이번 주는 아직 쓴 토큰이 없습니다" : "이 주에는 쓴 토큰이 없었습니다";
    if (r.prevTotal > 0) {
      const d = (r.total - r.prevTotal) / r.prevTotal;
      if (r.current && d < 0) return `지난 주의 ${pct(r.total / r.prevTotal)}까지 왔습니다`;
      if (Math.abs(d) < 0.05) return "지난 주와 거의 같게 썼습니다";
      return d > 0 ? `지난 주보다 ${pct(d)} 더 썼습니다` : `지난 주보다 ${pct(-d)} 덜 썼습니다`;
    }
    return r.current ? "이번 주가 진행 중입니다" : "지난 주 기록이 없어 견줄 수 없습니다";
  }

  function render(r) {
    keys = r.keys || [];
    key = r.key;
    const i = keys.indexOf(key);
    $("rpOlder").disabled = i < 0 || i >= keys.length - 1;
    $("rpNewer").disabled = i <= 0;
    const day = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d).getTime(); };
    const ago = keys[0] ? Math.round((day(keys[0]) - day(r.key)) / (7 * 86_400_000)) : 0;
    $("rpTitle").textContent = r.current ? "이번 주" : ago === 1 ? "지난 주" : `${ago}주 전`;
    $("rpRange").textContent = rangeLabel(r.key);

    const maxDay = Math.max(1, ...r.days);
    const bestDay = r.total ? r.days.indexOf(Math.max(...r.days)) : -1;
    const bars = r.days.map((n, d) => {
      const future = d > r.today;
      return `<div class="rd ${d === bestDay ? "best" : ""} ${future ? "fut" : ""} ${d === r.today && r.current ? "now" : ""}" title="${DAYS[d]} ${num(n)}">
        <i style="height:${Math.max(n ? 4 : 0, Math.round((n / maxDay) * 100))}%"></i><span>${DAYS[d]}</span></div>`;
    }).join("");

    const maxH = Math.max(1, ...r.hours);
    const peak = peakHours(r.hours);
    const heat = r.hours.map((n, h) => `<i title="${h}시 ${num(n)}" style="opacity:${n ? 0.18 + 0.82 * (n / maxH) : 0.06}"></i>`).join("");

    const src = r.sources.length > 1
      ? `<div class="rpsec"><h5>도구</h5>${r.sources.map((x) => `
          <div class="rsrc"><span class="l">${esc(x.label)}</span><span class="pb"><i style="width:${pct(x.n / r.total)}"></i></span><b>${pct(x.n / r.total)}</b></div>`).join("")}</div>`
      : r.sources.length ? `<div class="rpsub">전부 ${esc(r.sources[0].label)}에서 썼습니다</div>` : "";

    const times = r.total
      ? `<div class="rptimes">${r.burning ? `<span>🔥 버닝타임 몫 <b>${pct(r.burnShare)}</b></span>` : ""}<span>${cuR().icon} ${cuR().time} 몫 <b>${pct(r.sweetShare)}</b></span></div>`
      : "";

    const top = !r.tracked
      ? '<div class="rpsub">이 주에는 아이별 성장 기록이 없습니다. 리포트가 생긴 뒤부터 셉니다.</div>'
      : r.top.length
        ? r.top.map((x, k) => `
          <div class="rtop"><span class="rk">${k + 1}</span>${x.url ? `<img src="${x.url}" alt="">` : '<span class="ph"></span>'}
            <span class="nm">${esc(x.name)}${x.shiny ? " ★" : ""}</span><b>+${num(x.grown)}</b></div>`).join("") +
          (r.growTotal > r.top.reduce((a, x) => a + x.grown, 0) ? `<div class="rpsub">모두 합쳐 +${num(r.growTotal)} 자랐습니다</div>` : "")
        : '<div class="rpsub">아직 자란 아이가 없습니다</div>';

    const box = [
      `<span>🎓 졸업 <b>${r.grads.length}</b>마리</span>`,
      `<span>🥚 새 식구 <b>${r.newcomers}</b>마리</span>`,
    ].join("");
    const gradNames = r.grads.length ? `<div class="rpsub">${r.grads.map((g) => esc(g.name)).join(" · ")}</div>` : "";

    $("rpBody").innerHTML = `
      <div class="rpcard">
        <div class="rptot"><span class="n">${num(r.total)}</span><span class="u">토큰</span>
          ${r.prevTotal > 0 ? `<span class="vs">지난 주 ${num(r.prevTotal)}</span>` : ""}</div>
        <div class="rphl">${esc(headline(r))}</div>
        <div class="rdays">${bars}</div>
        ${bestDay >= 0 ? `<div class="rpsub">가장 많이 쓴 날 <b>${DAYS[bestDay]}요일</b> ${num(r.days[bestDay])}</div>` : ""}
      </div>
      ${r.total ? `<div class="rpsec"><h5>시간대${peak != null ? `<span>주로 <b>${hourName(peak)}</b></span>` : ""}</h5>
        <div class="rheat">${heat}</div><div class="rhax"><span>0</span><span>6</span><span>12</span><span>18</span><span>24시</span></div>${times}</div>` : ""}
      ${src}
      <div class="rpsec"><h5>가장 많이 자란 아이</h5>${top}</div>
      <div class="rpsec"><h5>박스</h5><div class="rptimes">${box}</div>${gradNames}</div>`;
  }

  async function load(k) {
    const r = await window.ptb.weekReport(k || null);
    if (r && r.ok) render(r);
  }

  /** 탭을 열 때 — 새 지난 주 리포트가 있으면 그걸 먼저, 아니면 이번 주 */
  function open() {
    const unread = !$("reportDot").hidden;
    $("reportDot").hidden = true;
    if (unread) {
      // keys[1] 이 가장 최근에 남긴 지난 주다 — 모르면 이번 주를 받고 나서 넘긴다
      window.ptb.weekReport(null).then((r) => (r && r.ok && r.keys[1] ? load(r.keys[1]) : r && r.ok && render(r)));
    } else load(null);
  }

  /** 갱신마다 — { unread } */
  function update(n) {
    if (n) $("reportDot").hidden = !n.unread;
  }

  $("rpOlder").onclick = () => { const i = keys.indexOf(key); if (i >= 0 && i < keys.length - 1) load(keys[i + 1]); };
  $("rpNewer").onclick = () => { const i = keys.indexOf(key); if (i > 0) load(keys[i - 1]); };

  window.ptbReport = { open, update };
})();
