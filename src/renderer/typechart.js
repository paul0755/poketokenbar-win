/*
 * ⚔️ 상성표 — 도감 탭의 "상성표" 쪽. 배틀이 쓰는 표(src/main/types.json)와 똑같은 18타입 상성.
 *   위: 막는 쪽 계산기 — 타입을 하나나 둘 고르면 몇 배로 맞는지, 하나면 공격할 때도
 *   아래: 🎡 상성 바퀴 — 18타입 대표 포켓몬을 한 원에. 하나를 고르면 그 타입이 강한 상대(파란 화살표)와
 *         그 타입에게 강한 상대(주황 화살표)를 잇는다. 아무것도 안 골랐으면 2배 관계 전체를 옅게
 * 특성(배짱 · 델타스트림 등)과 날씨는 빼고 본 기본 상성이다.
 */
(function () {
  const $ = (id) => document.getElementById(id);

  // src/main/types.json 그대로 — 번호: [이름, 키, 두 배, 절반, 없음]
  const T = {
    1: ["노말", "normal", [], [6, 9], [8]],
    2: ["격투", "fighting", [1, 6, 9, 15, 17], [3, 4, 7, 14, 18], [8]],
    3: ["비행", "flying", [2, 7, 12], [6, 9, 13], []],
    4: ["독", "poison", [12, 18], [4, 5, 6, 8], [9]],
    5: ["땅", "ground", [4, 6, 9, 10, 13], [7, 12], [3]],
    6: ["바위", "rock", [3, 7, 10, 15], [2, 5, 9], []],
    7: ["벌레", "bug", [12, 14, 17], [2, 3, 4, 8, 9, 10, 18], []],
    8: ["고스트", "ghost", [8, 14], [17], [1]],
    9: ["강철", "steel", [6, 15, 18], [9, 10, 11, 13], []],
    10: ["불꽃", "fire", [7, 9, 12, 15], [6, 10, 11, 16], []],
    11: ["물", "water", [5, 6, 10], [11, 12, 16], []],
    12: ["풀", "grass", [5, 6, 11], [3, 4, 7, 9, 10, 12, 16], []],
    13: ["전기", "electric", [3, 11], [12, 13, 16], [5]],
    14: ["에스퍼", "psychic", [2, 4], [9, 14], [17]],
    15: ["얼음", "ice", [3, 5, 12, 16], [9, 10, 11, 15], []],
    16: ["드래곤", "dragon", [16], [9], [18]],
    17: ["악", "dark", [8, 14], [2, 17, 18], []],
    18: ["페어리", "fairy", [2, 16, 17], [4, 9, 10], []],
  };
  const IDS = Object.keys(T).map(Number);

  /** 타입마다 대표 포켓몬(도감 번호) */
  const MON = {
    1: 133, 2: 66, 3: 18, 4: 23, 5: 50, 6: 74, 7: 10, 8: 92, 9: 81,
    10: 4, 11: 7, 12: 1, 13: 25, 14: 63, 15: 361, 16: 147, 17: 197, 18: 35,
  };

  /*
   * 바퀴 위 순서(12시부터 시계 방향). 서로 물고 물리는 셋이 가까이 앉게 —
   * 풀 › 물 › 불꽃, 땅 › 전기, 격투 › 악 › 에스퍼 › 격투, 격투 › 강철 › 페어리
   */
  const RING = [12, 11, 10, 15, 5, 13, 3, 6, 7, 4, 18, 9, 2, 17, 14, 8, 16, 1];

  /** 공격 타입 a 가 막는 타입 d 에게 몇 배 */
  function eff(a, d) {
    const t = T[a];
    return t[4].includes(d) ? 0 : t[2].includes(d) ? 2 : t[3].includes(d) ? 0.5 : 1;
  }
  const effAll = (a, ds) => ds.reduce((m, d) => m * eff(a, d), 1);

  /** 받침이 있으면 a, 없으면 b — "풀은" · "물은" · "에스퍼는" */
  const josa = (w, a, b) => {
    const c = w.charCodeAt(w.length - 1) - 0xac00;
    return w + (c >= 0 && c <= 11171 && c % 28 ? a : b);
  };

  const chip = (id) => `<span class="ty t-${T[id][1]}">${T[id][0]}</span>`;

  let pick = []; // 막는 쪽 타입(최대 2). 바퀴는 마지막에 고른 것을 본다
  let art = {}; // 도감 번호 → 그림 주소(메인이 캐시에서)

  /* ---------------- 계산기 ---------------- */

  function row(label, cls, ids) {
    if (!ids.length) return "";
    return `<div class="tc-row ${cls}"><span class="m">${label}</span><span class="cs">${ids.map((x) => chip(x)).join("")}</span></div>`;
  }

  function renderCalc() {
    const box = $("tcCalc");
    if (!pick.length) {
      box.innerHTML = '<div class="tc-hint">위에서 타입을 하나나 둘 고르면 — 몇 배로 맞는지 · 무엇에 강한지 보여 줍니다</div>';
      return;
    }
    const by = { 4: [], 2: [], 0.5: [], 0.25: [], 0: [] };
    for (const a of IDS) {
      const m = effAll(a, pick);
      if (by[m]) by[m].push(a);
    }
    let h = `<div class="tc-sec">🛡️ ${pick.map((x) => chip(x)).join("")} 타입이 맞을 때</div>`;
    h += row("×4", "x4", by[4]) + row("×2", "x2", by[2]) + row("×½", "h", by[0.5]) + row("×¼", "q", by[0.25]) + row("×0", "z", by[0]);
    if (!by[4].length && !by[2].length) h += '<div class="tc-hint">약점이 없습니다</div>';
    if (pick.length === 1) {
      const a = pick[0], t = T[a];
      h += `<div class="tc-sec">⚔️ ${chip(a)} 기술로 칠 때</div>`;
      h += row("×2", "x2", t[2]) + row("×½", "h", t[3]) + row("×0", "z", t[4]);
      if (!t[2].length) h += '<div class="tc-hint">효과가 굉장한 상대가 없습니다</div>';
    } else {
      // 두 타입이면 — 둘 중 하나로 2배 이상 칠 수 있는 상대(자속 기술 기준)
      const good = IDS.filter((d) => pick.some((a) => eff(a, d) === 2));
      h += `<div class="tc-sec">⚔️ 두 타입 기술 중 하나로 효과가 굉장한 상대</div>`;
      h += good.length ? row("×2", "x2", good) : '<div class="tc-hint">없습니다</div>';
    }
    box.innerHTML = h;
  }

  function renderPicker() {
    $("tcPick").innerHTML =
      IDS.map((id) => `<button data-tc="${id}" class="ty t-${T[id][1]}${pick.includes(id) ? " on" : ""}">${T[id][0]}</button>`).join("") +
      `<button class="tc-clear" data-tc="0"${pick.length ? "" : " hidden"}>지우기</button>`;
  }

  /* ---------------- 🎡 상성 바퀴 ---------------- */

  const R = 39; // 원의 반지름(판의 %)
  const NODE = 6.6; // 화살표가 그림을 덮지 않게 양 끝을 이만큼 줄인다(%)
  const POS = {};
  RING.forEach((id, i) => {
    const a = (i / RING.length) * Math.PI * 2 - Math.PI / 2;
    POS[id] = [50 + R * Math.cos(a), 50 + R * Math.sin(a)];
  });

  /**
   * a → b 화살표(판 viewBox 0 0 100 100). 멀면 진행 방향 오른쪽으로 살짝 휘고(a→b 와 b→a 가 겹치지 않게),
   * 바로 옆 · 두 칸 옆이면 그림 사이에 자리가 없어 원 안쪽으로 크게 돌아 들어간다
   */
  function edge(a, b, cls) {
    const [x1, y1] = POS[a], [x2, y2] = POS[b];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    let cx, cy;
    if (len < 30) {
      const in_ = len < 16 ? 15 : 10; // 가운데 쪽으로 이만큼
      const ox = 50 - mx, oy = 50 - my, ol = Math.hypot(ox, oy) || 1;
      cx = mx + (ox / ol) * in_;
      cy = my + (oy / ol) * in_;
    } else {
      const bend = Math.min(7, len * 0.12);
      cx = mx - (dy / len) * bend;
      cy = my + (dx / len) * bend;
    }
    // 양 끝은 휘는 쪽(조절점)을 향해 그림 반지름만큼 줄인다 — 화살표가 그림 밖에서 나가고 들어온다
    const cut = (x, y, d) => {
      const vx = cx - x, vy = cy - y, vl = Math.hypot(vx, vy) || 1;
      return [x + (vx / vl) * d, y + (vy / vl) * d];
    };
    const [sx, sy] = cut(x1, y1, NODE), [ex, ey] = cut(x2, y2, NODE + 1.2);
    const f = (n) => n.toFixed(2);
    return `<path class="${cls}" d="M${f(sx)},${f(sy)} Q${f(cx)},${f(cy)} ${f(ex)},${f(ey)}"/>`;
  }

  function renderWheel() {
    const f = pick[pick.length - 1] || 0; // 바퀴가 보는 타입
    let lines = "";
    const strong = f ? T[f][2] : [];
    const weak = f ? IDS.filter((a) => eff(a, f) === 2) : [];
    const none = f ? T[f][4] : [];
    if (!f) {
      // 아무것도 안 골랐으면 2배 관계 전체를 옅게
      for (const a of IDS) for (const d of T[a][2]) if (a !== d) lines += edge(a, d, "all");
    } else {
      for (const d of weak) if (d !== f) lines += edge(d, f, "weak");
      for (const d of strong) if (d !== f) lines += edge(f, d, "strong");
      for (const d of none) lines += edge(f, d, "none");
    }
    const svg = `<svg viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <marker id="tcS" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker>
        <marker id="tcW" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker>
      </defs>${lines}</svg>`;

    const self = f && T[f][2].includes(f);
    const nodes = RING.map((id) => {
      const [x, y] = POS[id];
      const url = art[MON[id]];
      const st = !f ? "" : id === f || pick.includes(id) ? " sel" : strong.includes(id) ? " s" : weak.includes(id) ? " w" : none.includes(id) ? " z" : " dim";
      return `<div class="tc-wn t-${T[id][1]}${st}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%" data-tc="${id}" title="${T[id][0]}">
        <div class="pic">${url ? `<img src="${url}" alt="">` : `<b>${T[id][0][0]}</b>`}</div><span class="ty t-${T[id][1]}">${T[id][0]}</span></div>`;
    }).join("");

    // 가운데 — 고른 타입 이야기
    let mid;
    if (!f) {
      mid = `<div class="tc-mid"><b>🎡 18타입 상성</b><span>포켓몬을 누르면<br>무엇에 강하고 약한지<br>화살표로 보여 줍니다</span></div>`;
    } else {
      mid = `<div class="tc-mid on">${chip(f)}<span class="s">→ 강하다 ${strong.length}</span><span class="w">← 약하다 ${weak.length}</span>${self ? '<span class="me">↻ 자기 타입에도 강하다</span>' : ""}</div>`;
    }
    $("tcWheel").innerHTML = svg + nodes + mid;

    // 아래 한 줄 설명
    const names = (ids) => ids.map((x) => T[x][0]).join(" · ");
    $("tcWheelSay").innerHTML = !f
      ? "옅은 선 하나가 2배 관계 하나 — 선을 따라가면 서로 물고 물리는 셋(풀 › 물 › 불꽃 같은)이 보입니다"
      : [
          strong.length ? `<span class="s">🔵 ${josa(T[f][0], "은", "는")} ${names(strong)}에 강하다</span>` : `<span class="s">🔵 ${josa(T[f][0], "은", "는")} 강한 상대가 없다</span>`,
          weak.length ? `<span class="w">🟠 ${names(weak)} 기술에 약하다</span>` : `<span class="w">🟠 약점이 없다</span>`,
          none.length ? `<span class="z">⚫ ${names(none)}에게는 안 맞는다</span>` : "",
        ].filter(Boolean).join("");
  }

  function render() {
    renderPicker();
    renderCalc();
    renderWheel();
  }

  function toggle(id) {
    if (!id) pick = [];
    else if (pick.includes(id)) pick = pick.filter((x) => x !== id);
    else pick = pick.length >= 2 ? [pick[1], id] : [...pick, id];
    render();
  }

  $("tcPick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tc]");
    if (b) toggle(Number(b.dataset.tc));
  });
  // 바퀴의 포켓몬 — 누르면 그 타입 하나만(다시 누르면 풀린다)
  $("tcWheel").addEventListener("click", (e) => {
    const n = e.target.closest(".tc-wn[data-tc]");
    if (!n) return;
    const id = Number(n.dataset.tc);
    pick = pick.length === 1 && pick[0] === id ? [] : [id];
    render();
  });

  /** 그림은 처음 열 때 한 번 — 메인이 캐시에 받아 둔다(인터넷이 없으면 타입 이름 첫 글자) */
  let asked = false;
  function loadArt() {
    if (asked || !window.ptb || !window.ptb.typeArt) return;
    asked = true;
    window.ptb.typeArt(Object.values(MON)).then((m) => {
      art = m || {};
      renderWheel();
    }).catch(() => (asked = false));
  }

  // 도감 ⇄ 상성표
  $("dxSwitch").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]");
    if (!b) return;
    for (const x of $("dxSwitch").querySelectorAll("button")) x.classList.toggle("on", x === b);
    $("dxDex").hidden = b.dataset.view !== "dex";
    $("dxType").hidden = b.dataset.view !== "type";
    if (b.dataset.view === "type") loadArt();
  });

  render();
  window.ptbTypeChart = { eff, effAll, T, RING, loadArt };
})();
