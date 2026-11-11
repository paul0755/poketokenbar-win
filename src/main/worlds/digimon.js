"use strict";
/**
 * 🦖 디지털 월드 — pokemon.js 와 같은 모양(describe · stageFor · LINES …)으로 디지몬을 내놓는다.
 * 앱의 나머지는 어느 세계인지 몰라도 돌게 하는 게 목표다(world.js 가 이걸 poke 자리에 꽂는다).
 *
 * ── 단계 ──
 * 문턱은 포켓몬과 같다. 이름만 디지몬 식으로: 디지타마 → 성장기 → 성숙기 → 완전체 → 궁극체.
 * 마스터(궁극체)는 이로치가 아니라 다른 디지몬이다 — 디지몬에는 이로치가 없다.
 *
 * ── 진화가 갈린다 ──
 * LINES 는 성장기에서 궁극체까지 이어지는 "길" 하나하나다(digimon.json 의 진화로 만든 모든 길).
 * 알에서 깰 때 성장기 하나가 정해지고, 단계를 넘을 때마다 다음 모습을 그 사이 토큰을 어떻게 썼느냐로 고른다:
 *   Claude 를 많이 썼으면 백신(Vaccine) · Codex 를 많이 썼으면 데이터(Data) · 밤(22~6시)에 많이 썼으면 바이러스(Virus).
 * 고르면 그 모습까지 같은 길로 m.line 을 옮긴다 — describe 는 길만 보면 되니 다른 곳은 바뀌는 줄 모른다.
 * 정한 모습은 m.dg(성장기부터의 key 목록)에도 적는다. 데이터를 다시 만들어 길 번호가 바뀌어도 m.dg 로 되찾는다.
 *
 * 그림: assets/digimon (scripts/digimon.js 로 humulos.com 의 Vital Bracelet 도트를 한 번 받아 둔 것).
 */
const fs = require("node:fs");
const path = require("node:path");

const DATA = require("./digimon.json");
const KO = require("./digimon-names.json");
const NATURES = require("../natures.json");
const SPR = path.join(__dirname, "..", "..", "..", "assets", "digimon");

const STAGES = [
  { key: "egg", at: 0, label: "디지타마" },
  { key: "baby", at: 5_000_000, label: "성장기" },
  { key: "mid", at: 80_000_000, label: "성숙기" },
  { key: "final", at: 400_000_000, label: "완전체" },
  { key: "master", at: 1_500_000_000, label: "궁극체" },
];
const TWO_STAGE_MASTER = 900_000_000; // 포켓몬과 모양을 맞추려고 둔다 — 디지몬 길은 늘 네 모습이다
const stagesOf = () => STAGES;
const isTwoStage = () => false;

/* ---------------- 디지몬 · 번호 ---------------- */

const LEVEL_ORDER = ["Child", "Adult", "Perfect", "Ultimate"];
const KEYS = Object.keys(DATA.nodes).sort(
  (a, b) => LEVEL_ORDER.indexOf(DATA.nodes[a].level) - LEVEL_ORDER.indexOf(DATA.nodes[b].level) || DATA.nodes[a].en.localeCompare(DATA.nodes[b].en),
);
// 도감 번호 — 포켓몬(1~649)과 겹치지 않게 10001 부터. 단계 순 · 이름 순
const ID = new Map(KEYS.map((k, i) => [k, 10001 + i]));
const KEY_OF = new Map(KEYS.map((k) => [ID.get(k), k]));
const nameOf = (k) => KO[DATA.nodes[k].en] || DATA.nodes[k].en;
/** 필살기 이름 — "Marathi: Lotus Act" 같은 언어 머리말은 뗀다. 바탕화면 펫이 쓴다(renderer/digifx.js) */
const skillsOf = (k) => ((DATA.nodes[k] || {}).skills || []).map((x) => x.replace(/^[A-Z][a-z]{1,8}:\s*/, "")).filter(Boolean);
const ATTR_KO = { Vaccine: "백신", Data: "데이터", Virus: "바이러스", Free: "프리", Unknown: "언노운" };

/** 성장기에서 궁극체까지의 모든 길 */
const LINES = [];
(function build() {
  const walk = (k, acc) => {
    const p = [...acc, k];
    const nx = DATA.next[k] || [];
    if (p.length === 4) return void LINES.push(p);
    for (const n of nx) walk(n, p);
  };
  for (const s of [...DATA.starters].sort()) walk(s, []);
})();
LINES.forEach((p, i) => {
  LINES[i] = {
    line: nameOf(p[0]),
    keys: [null, ...p],
    ids: [null, ...p.map((k) => ID.get(k))],
    names: ["디지타마", ...p.map(nameOf)],
    captureRate: 45,
    legendary: false,
  };
});
const STARTERS = [...new Set(LINES.map((L) => L.keys[1]))];

/*
 * 🧬 조그레스(합체 진화) — 두 디지몬이 만나야만 되는 진화. 보통 진화(DATA.next)에는 없다 — 단계를 넘어도
 * 저절로 그쪽으로 가지 않는다. 박스의 짝과 💠 비트로 "합체" 탭에서 한다(index.js jogress).
 *   DATA.fuse = { 결과: [{ from: 밑동, partner: { keys: [디지몬] } | { attrs: ["Data"], level: "Adult" } }] }
 * 결과가 밑동보다 한 단계 위면 다음 모습으로, 같은 단계면(워그레이몬+메탈가루몬 → 오메가몬처럼) 그 자리를 바꾼다.
 * describe 가 길만 보면 되도록, 합체로 가는 길도 LINES 에 덧붙인다(fused — 디지타마에서는 안 나온다).
 * 보통 길 번호가 그대로이게 맨 뒤에 붙인다.
 */
const FUSE = DATA.fuse || {};
const FUSE_FROM = new Map();
for (const [to, rs] of Object.entries(FUSE)) for (const r of rs) {
  if (!DATA.nodes[r.from] || !DATA.nodes[to]) continue;
  if (!FUSE_FROM.has(r.from)) FUSE_FROM.set(r.from, []);
  FUSE_FROM.get(r.from).push({ to, partner: r.partner });
}
const lv = (k) => LEVEL_ORDER.indexOf(DATA.nodes[k].level); // 0 성장기 ~ 3 궁극체
(function fusedLines() {
  const seen = new Set(LINES.map((L) => L.keys.join(">")));
  const cont = (k, need) => {
    if (need <= 0) return [[]];
    const nx = DATA.next[k] || [];
    if (!nx.length) return [Array(need).fill(k)]; // 더 갈 데가 없으면 그 모습 그대로(궁극체에서 합친 경우)
    return nx.flatMap((n) => cont(n, need - 1).map((rest) => [n, ...rest]));
  };
  const base = LINES.slice();
  for (const [from, rs] of FUSE_FROM) {
    const la = lv(from);
    for (const r of rs) {
      const lt = lv(r.to);
      if (lt !== la && lt !== la + 1) continue;
      for (const L of base) {
        if (L.keys[la + 1] !== from) continue;
        const prefix = L.keys.slice(1, lt === la ? la + 1 : la + 2);
        for (const rest of cont(r.to, 4 - prefix.length - 1)) {
          const p = [...prefix, r.to, ...rest];
          const key = [null, ...p].join(">");
          if (seen.has(key)) continue;
          seen.add(key);
          LINES.push({ line: nameOf(p[0]), keys: [null, ...p], ids: [null, ...p.map((k) => ID.get(k))], names: ["디지타마", ...p.map(nameOf)], captureRate: 45, legendary: false, fused: true });
        }
      }
    }
  }
})();

/**
 * 디지타마 무늬 — 깨어날 성장기마다 하나. 박스 · 홈 · 펫에서 알일 때 이 무늬로 그린다(renderer/egg.js).
 * 상점에서는 디지코드 알이라 무엇이 나올지 모른다 — 사서 박스에 들어와야 무늬가 보인다.
 * { h: 바탕 색상(0~359), a: 무늬 색상, m: 무늬 } — 성장기를 이름순으로 늘어놓고 황금각으로 색을 벌린다
 */
const MOTIFS = ["stripes", "stars", "rings", "hearts", "bands", "spots", "triangles", "zigzag", "diamonds", "flames", "waves"];
const EGG = new Map(
  [...STARTERS].sort().map((k, i) => {
    const h = Math.round((i * 137.508) % 360);
    return [k, { h, a: (h + 150 + ((i * 47) % 90)) % 360, m: MOTIFS[i % MOTIFS.length] }];
  }),
);

/** 정한 모습(성장기부터)으로 시작하는 첫 길 */
function lineFor(dg) {
  const i = LINES.findIndex((L) => dg.every((k, j) => L.keys[j + 1] === k));
  return i >= 0 ? i : LINES.findIndex((L) => L.keys[1] === dg[0]);
}

/* ---------------- 뽑기 ---------------- */

const RARITY = [{ max: Infinity, weight: 10, label: "디지몬", stars: 0 }]; // 별 없음 — 디지몬은 등급 대신 속성(백신 · 데이터 · 바이러스)
const rarityOf = () => ({ ...RARITY[0], captureRate: 45, legendary: false });
const isSingle = () => false;

/** 디지타마 — 성장기를 고르게 하나 고르고, 그 성장기로 시작하는 길 하나. 앞길은 자라면서 다시 갈린다 */
function roll(exclude = null) {
  const not = exclude != null && LINES[exclude] ? LINES[exclude].keys[1] : null;
  const pool = STARTERS.filter((k) => k !== not);
  const k = pool[Math.floor(Math.random() * pool.length)] || STARTERS[0];
  const ways = LINES.map((L, i) => (L.keys[1] === k && !L.fused ? i : -1)).filter((i) => i >= 0); // 합체 길은 알에서 안 나온다
  return ways[Math.floor(Math.random() * ways.length)];
}
const rollAtLeast = (_min, exclude) => roll(exclude);
const rollWild = () => roll();
const rollLegend = (exclude) => roll(exclude);
const rollChance = () => 100 / STARTERS.length;
const SHINY_BASE = 0;
const rollShiny = () => false;
const rollNature = () => Math.floor(Math.random() * NATURES.length);

/* ---------------- 단계 ---------------- */

function stageFor(total) {
  let i = 0;
  for (let k = 0; k < STAGES.length; k++) if (total >= STAGES[k].at) i = k;
  return i;
}

function progress(total) {
  const i = stageFor(total);
  if (!STAGES[i + 1]) return { ratio: 1, remaining: 0, next: null };
  const from = STAGES[i].at, next = STAGES[i + 1];
  return { ratio: Math.min(1, (total - from) / (next.at - from)), remaining: next.at - total, next: next.label };
}

/** 변하지않는돌 — 다음 진화 바로 앞에서 멈춘다(디지몬은 단계마다 모습이 바뀐다). 궁극체 앞도 막는다 */
function stoneCap(_line, total) {
  const s = stageFor(total);
  if (s === 0 || s >= 4) return null;
  return STAGES[s + 1].at - 1;
}

/** 상점이 사 주는 값 — 디지털 월드에는 몰이 없다(1단계). 모양만 맞춘다 */
const STAGE_COINS = [0, 1, 1.5, 2, 3];
const shopPrice = (_line, total) => Math.max(0, Math.round(5 * STAGE_COINS[stageFor(total)]));

const look = () => ({ shiny: false, plain: true });

function describe(total, lineIndex = 0) {
  const L = LINES[lineIndex % LINES.length];
  const i = stageFor(total);
  const k = L.keys[i];
  return {
    line: L.line,
    name: L.names[i],
    stageIndex: i,
    stage: STAGES[i],
    dexId: L.ids[i],
    isEgg: i === 0,
    isShiny: false,
    egg: i === 0 ? EGG.get(L.keys[1]) || null : null, // 🥚 디지타마 무늬 — 알일 때만
    skills: k ? skillsOf(k) : [], // 필살기 — 펫이 쓰는 기술
    attr: k ? ATTR_KO[DATA.nodes[k].attr] || null : null,
    progress: progress(total),
  };
}

/**
 * 진화 트리 — 지나온 모습과 지금 모습만. 앞길은 아직 안 정해졌다(쓰는 대로 갈린다) — "?" 로.
 */
function evolutionTree(lineIndex, total) {
  const L = LINES[lineIndex % LINES.length];
  const now = stageFor(total);
  const nodes = [];
  for (let i = 1; i < STAGES.length; i++) {
    const known = i <= now;
    nodes.push({
      name: known ? L.names[i] : STAGES[i].label, // 아직 모르는 모습은 단계 이름으로
      dexId: known ? L.ids[i] : null,
      isShiny: false,
      at: STAGES[i].at,
      stageIndex: i,
      reached: total >= STAGES[i].at,
      current: i === now,
      unknown: !known,
    });
  }
  return nodes;
}

/* ---------------- 그림 ---------------- */

function spritePath(dexId, _cacheDir, { kind = "anim" } = {}) {
  const k = KEY_OF.get(dexId);
  if (!k) return null;
  const f = path.join(SPR, DATA.nodes[k].sprite + (kind === "still" ? "-still" : "") + ".gif");
  return fs.existsSync(f) ? f : null;
}
async function spriteWithFallback(mon, cacheDir, kind) {
  if (!mon || !mon.dexId) return null;
  return spritePath(mon.dexId, cacheDir, { kind });
}

/* ---------------- 갈림길 ---------------- */

const inNight = (t) => {
  const h = new Date(t).getHours();
  return h >= 22 || h < 6;
};

/**
 * (from, to] 사이 토큰을 어떻게 썼나 — { claude, codex, night } 비율과 합계.
 * 그 사이 기록이 없으면(사탕으로 한 번에 자란 경우 등) 최근 7일로 본다.
 */
function habits(events, from, to) {
  const sum = (a, b) => {
    let all = 0, claude = 0, codex = 0, night = 0;
    for (const e of events || []) {
      if (e.t <= a || e.t > b) continue;
      all += e.n;
      if (e.src === "claude") claude += e.n;
      else codex += e.n; // codex · opencodex
      if (inNight(e.t)) night += e.n;
    }
    return { all, claude, codex, night };
  };
  let s = sum(from, to);
  if (!s.all) s = sum(to - 7 * 86_400_000, to);
  const r = (x) => (s.all ? x / s.all : 0);
  return { tokens: s.all, claude: r(s.claude), codex: r(s.codex), night: r(s.night) };
}

/** 속성마다 무게 — 그 버릇이 셀수록 그쪽으로. 아무 버릇이 없어도 어느 쪽이든 갈 수는 있다 */
function weightOf(attr, h) {
  if (attr === "Vaccine") return 0.3 + 3 * h.claude;
  if (attr === "Data") return 0.3 + 3 * h.codex;
  if (attr === "Virus") return 0.3 + 3 * h.night;
  return 0.8; // 프리 · 알 수 없음
}

function pick(options, h) {
  const ws = options.map((k) => weightOf(DATA.nodes[k].attr, h));
  let r = Math.random() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < options.length; i++) if ((r -= ws[i]) <= 0) return options[i];
  return options[options.length - 1];
}

/**
 * 단계를 넘었으면 다음 모습을 정한다. 바뀐 게 있으면 true(세이브를 써야 한다).
 * 처음 보는 개체(m.dg 없음)는 지금 모습까지를 그대로 정한 것으로 친다 — 거슬러 다시 고르지 않는다.
 */
function branch(m, total, events, now = Date.now()) {
  if (!m || !LINES.length) return false;
  let dirty = false;
  const st = stageFor(total);
  if (!Array.isArray(m.dg) || !m.dg.length) {
    const L = LINES[m.line % LINES.length] || LINES[0];
    m.dg = L.keys.slice(1, Math.max(1, st) + 1);
    m.dgAt = now;
    dirty = true;
  }
  // 길 번호가 정한 모습과 어긋나면(데이터를 다시 만든 뒤 등) 되찾는다
  const cur = LINES[m.line];
  if (!cur || !m.dg.every((k, j) => cur.keys[j + 1] === k)) {
    const i = lineFor(m.dg);
    if (i >= 0 && i !== m.line) { m.line = i; dirty = true; }
  }
  while (m.dg.length < st) {
    const options = DATA.next[m.dg[m.dg.length - 1]] || [];
    if (!options.length) break;
    const h = habits(events, m.dgAt || 0, now);
    const k = pick(options, h);
    m.dg.push(k);
    m.dgWhy = h; // 왜 그쪽으로 갔나 — 화면에서 보여 줄 수 있게
    m.dgAt = now;
    const i = lineFor(m.dg);
    if (i >= 0) m.line = i;
    dirty = true;
  }
  return dirty;
}

/* ---------------- 🧬 조그레스 ---------------- */

const FUSE_COST = { Child: 2, Adult: 3, Perfect: 5, Ultimate: 10 }; // 💠 비트 — 결과 단계가 높을수록
const LEVEL_KO = { Child: "성장기", Adult: "성숙기", Perfect: "완전체", Ultimate: "궁극체" };
const READY = 0.5; // 이번 단계를 절반 넘게 자라야(진화 데이터가 반쯤 찼을 때) 합칠 수 있다 — 궁극체는 언제든

/** 지금 모습 key — m.dg 를 맞춘 뒤의 마지막 모습(알이면 null) */
function keyNow(m, total) {
  const st = stageFor(total);
  if (!st) return null;
  const L = LINES[m.line % LINES.length];
  return L ? L.keys[st] : null;
}

/** 짝 조건을 말로 — "스팅몬" · "데이터 · 프리 속성 성숙기" */
function partnerText(p) {
  if (p.keys) return p.keys.map(nameOf).join(" · ");
  return `${p.attrs.map((a) => ATTR_KO[a] || a).join(" · ")} 속성 ${LEVEL_KO[p.level] || p.level}`;
}

/** 이 디지몬(지금 모습 key)이 짝이 되나 */
function fits(p, key) {
  if (!key) return false;
  if (p.keys) return p.keys.includes(key);
  const n = DATA.nodes[key];
  return Boolean(n && n.level === p.level && p.attrs.includes(n.attr));
}

/**
 * 이 아이가 할 수 있는 합체 — [{ to, toId, name, level, cost, partner: { text, spec }, ready, ratio }]
 * ratio 는 이번 단계를 얼마나 자랐나(0~1). 궁극체(마스터)는 1
 */
function fuseOptions(m, total) {
  const k = keyNow(m, total);
  if (!k) return [];
  const st = stageFor(total);
  const ratio = st >= 4 ? 1 : progress(total).ratio;
  return (FUSE_FROM.get(k) || []).map((r) => ({
    to: r.to,
    toId: ID.get(r.to),
    name: nameOf(r.to),
    level: LEVEL_KO[DATA.nodes[r.to].level],
    cost: FUSE_COST[DATA.nodes[r.to].level] || 5,
    partner: { text: partnerText(r.partner), spec: r.partner },
    ready: ratio >= READY,
    ratio,
    from: k,
  }));
}

/**
 * 합친다 — m 이 결과 모습이 된다. 돌려주는 것: 결과가 몇 단계(1~4)인가. 그 단계 문턱까지 성장량을 채우는 건
 * 부르는 쪽(index.js)이 한다(난이도 · 성장 속도를 안다)
 */
function applyFuse(m, total, to, now = Date.now()) {
  const k = keyNow(m, total);
  const r = (FUSE_FROM.get(k) || []).find((x) => x.to === to);
  if (!r) return null;
  const la = lv(k), lt = lv(to);
  const dg = (Array.isArray(m.dg) && m.dg.length ? m.dg : LINES[m.line].keys.slice(1, la + 2)).slice(0, la + 1);
  if (lt === la) dg[la] = to;
  else dg.push(to);
  m.dg = dg;
  m.dgAt = now;
  const i = lineFor(dg);
  if (i >= 0) m.line = i;
  return { stage: lt + 1 };
}

/* ---------------- 도감 ---------------- */

/** 도감에 올릴 디지몬 — 하나씩(길마다 겹치지 않게). line 은 그 디지몬이 처음 나오는 길 */
function species() {
  return KEYS.map((k) => {
    const st = LEVEL_ORDER.indexOf(DATA.nodes[k].level) + 1;
    const line = LINES.findIndex((L) => L.keys[st] === k);
    return { dexId: ID.get(k), line, stage: st, name: nameOf(k), attr: ATTR_KO[DATA.nodes[k].attr] };
  }).filter((s) => s.line >= 0);
}

/** 만난 디지몬 — 길마다 어디까지 갔나(maxStage)에서 그 길의 지나온 모습을 모은다 */
function seenIds(maxStage) {
  const out = new Set();
  for (const [li, ms] of Object.entries(maxStage || {})) {
    const L = LINES[li];
    if (!L) continue;
    for (let i = 1; i <= ms && i < L.ids.length; i++) out.add(L.ids[i]);
  }
  return out;
}

/* ---------------- ⚔️ 필드 배틀 ----------------
 * 결투는 늘 성장기 모습으로 시작해서, 싸우는 중에 지금 모습까지 진화해 올라간다(renderer/digibattle.js).
 * 그래서 넘겨줄 건 성장기부터 지금 모습까지의 길이다. 야생 상대는 아무 길에서 같은 단계까지
 */
const formOf = (k) => ({ key: k, id: ID.get(k), name: nameOf(k), stage: lv(k) + 1, attr: ATTR_KO[DATA.nodes[k].attr] || "언노운", skill: skillsOf(k)[0] || null, skills: skillsOf(k) });
function battleForms(m, total) {
  const st = stageFor(total);
  if (!st) return null;
  const L = LINES[m.line % LINES.length];
  return L ? L.keys.slice(1, st + 1).map(formOf) : null;
}
function wildForms(stage, rnd = Math.random) {
  const pool = LINES.filter((L) => !L.fused);
  const L = pool[Math.floor(rnd() * pool.length)];
  return L.keys.slice(1, Math.max(1, Math.min(4, stage)) + 1).map(formOf);
}

module.exports = {
  WORLD: "digimon",
  look, STAGES, TWO_STAGE_MASTER, stagesOf, isTwoStage, LINES, NATURES, RARITY, SHINY_BASE,
  rarityOf, rollChance, roll, rollAtLeast, rollWild, rollLegend, isSingle, shopPrice, rollShiny, rollNature,
  stageFor, stoneCap, progress, describe, evolutionTree, spritePath, spriteWithFallback,
  branch, habits, species, seenIds,
  fuseOptions, applyFuse, fits, keyNow, FUSE_COST,
  battleForms, wildForms,
};
