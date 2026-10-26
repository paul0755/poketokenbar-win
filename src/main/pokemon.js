"use strict";
/**
 * 토큰 → 포켓몬 진화 단계.
 *
 * 임계값은 실제 사용량을 보고 정했다. 하루 5천만~1억 토큰을 쓰는 사람에게
 * "1억에 부화"는 너무 멀고, "100만에 최종진화"는 하루 만에 끝난다.
 * 첫날 부화하고, 한 주 열심히 쓰면 최종 진화하는 감각을 목표로 했다.
 */
const fs = require("node:fs");
const path = require("node:path");

const STAGES = [
  { key: "egg", at: 0, label: "알" },
  { key: "baby", at: 5_000_000, label: "부화" },
  { key: "mid", at: 80_000_000, label: "1차 진화" },
  { key: "final", at: 400_000_000, label: "최종 진화" },
  { key: "master", at: 1_500_000_000, label: "마스터" },
];

/**
 * 진화 라인. ids/names는 STAGES와 같은 길이로 맞춘다.
 * 마스터는 최종 진화와 같은 종이지만 이로치(shiny)로 보여준다 — 보상.
 *
 * 손으로 적지 않는다 — 도감 번호도 한국어 이름도 반드시 틀린다.
 * scripts/build-lines.mjs 가 PokéAPI에서 받아 생성한다:
 *
 *   node scripts/build-lines.mjs
 *
 * 생성물을 커밋해두므로 앱 실행 시에는 네트워크를 타지 않는다.
 */
const LINES = require("./lines.json");

const NATURES = require("./natures.json");

/**
 * 희귀도. 공식 포획률(3~255, 낮을수록 희귀)을 5등급으로 묶는다.
 *
 * 경계는 실제 분포를 보고 잡았다. 221개 라인의 포획률은
 * 30 이하 4개 / 45 이하 44개 / 120 이하 65개 / 나머지 156개로
 * 45와 120 부근에 계단이 있다. 그 계단을 등급 경계로 썼다.
 *
 * 가중치 차이는 4배까지만 둔다. 포획률을 그대로 쓰면 85배가 되어
 * 가장 희귀한 종이 1/12,000이 된다 — 평생 안 나오는 건 등급이 아니라 부재다.
 */
const RARITY = [
  { max: 30, weight: 5, label: "초희귀", stars: 5 },
  { max: 45, weight: 8, label: "희귀", stars: 4 },
  { max: 90, weight: 11, label: "보기 드묾", stars: 3 },
  { max: 150, weight: 15, label: "보통", stars: 2 },
  { max: Infinity, weight: 20, label: "흔함", stars: 1 },
];

/**
 * 진화하지 않는 종(전설·환상·메타몽 등) — lines.json 의 single. 알에서는 안 나오고 야생에서만
 * 만난다. 다섯 칸이 같은 종이라 모습은 그대로고 레벨만 오른다. 마스터에 닿으면 이로치.
 */
const isSingle = (lineIndex) => Boolean((LINES[lineIndex] || {}).single);

/**
 * 야생에서 만날 가중치. 진화 라인과 진화 없는 보통 종은 희귀도 그대로, 전설은 아주 드물게.
 * 하루 4~10번 나오는데 전설이 몇 주에 한 번쯤 — 전체의 0.7% 남짓이 되게 잡았다.
 */
const LEGEND_WEIGHT = 0.6;
const MYTHICAL_WEIGHT = 0.3;
function wildWeight(lineIndex) {
  const L = LINES[lineIndex];
  if (L && L.single && L.legendary) return L.mythical ? MYTHICAL_WEIGHT : LEGEND_WEIGHT;
  return rarityOf(lineIndex).weight;
}

function rarityOf(lineIndex) {
  const L = LINES[lineIndex % LINES.length];
  const cr = L.captureRate ?? 45;
  const tier = RARITY.find((r) => cr <= r.max);
  return { ...tier, captureRate: cr, legendary: Boolean(L.legendary) };
}

/** 각 라인의 뽑기 확률(%) — 설명용. 진화 없는 종은 알에서 안 나오니 야생에서 만날 확률 */
function rollChance(lineIndex) {
  if (isSingle(lineIndex)) {
    const total = LINES.reduce((a, _, i) => a + wildWeight(i), 0);
    return (wildWeight(lineIndex) / total) * 100;
  }
  const total = LINES.reduce((a, _, i) => a + (isSingle(i) ? 0 : rarityOf(i).weight), 0);
  return (rarityOf(lineIndex).weight / total) * 100;
}

/** 야생 — 진화 없는 종(전설 포함)도 나온다 */
function rollWild() {
  const weights = LINES.map((_, i) => wildWeight(i));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return 0;
}

/**
 * 뽑기. 희귀도로 가중치를 준다.
 *
 * 지금 키우는 것은 제외한다 — 뽑았는데 같은 게 또 나오면 뽑은 것 같지가 않다.
 */
function roll(exclude = null) {
  if (LINES.length < 2) return 0;
  // 진화 없는 종은 알에서 안 나온다 — 야생에서만(rollWild)
  const weights = LINES.map((_, i) => (i === exclude || isSingle(i) ? 0 : rarityOf(i).weight));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.findIndex((w) => w > 0); // 부동소수점 보정
}

/**
 * 최소 ★등급을 보장하는 뽑기.
 *
 * 후보를 등급으로 먼저 거르고 그 안에서 가중치를 적용한다.
 * "★4 이상 확정"이 ★4만 나온다는 뜻이 되면 안 된다 — ★5도 나와야 한다.
 */
function rollAtLeast(minStars, exclude = null) {
  const pool = LINES.map((_, i) => i).filter(
    (i) => i !== exclude && !isSingle(i) && rarityOf(i).stars >= minStars,
  );
  if (!pool.length) return roll(exclude); // 그런 등급이 없으면 일반 뽑기로
  const weights = pool.map((i) => rarityOf(i).weight);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let k = 0; k < pool.length; k++) {
    r -= weights[k];
    if (r <= 0) return pool[k];
  }
  return pool[pool.length - 1];
}

/** 이로치가 나올 확률. 부적을 사면 두 배가 된다. */
const SHINY_BASE = 1 / 128;
function rollShiny(hasCharm = false) {
  return Math.random() < (hasCharm ? SHINY_BASE * 2 : SHINY_BASE);
}

/** 성격 하나를 뽑는다. 능력치 보정은 표시용이고 게임에 영향은 없다. */
function rollNature() {
  return Math.floor(Math.random() * NATURES.length);
}

function stageFor(total) {
  let i = 0;
  for (let k = 0; k < STAGES.length; k++) if (total >= STAGES[k].at) i = k;
  return i;
}

/**
 * 변하지않는돌을 지니면 성장이 어디서 멈추나 — 다음에 "종이 바뀌는" 단계 바로 앞.
 *
 * 2단 진화 라인은 1차와 최종이 같은 종이라, 1차에서 최종으로 가는 건 진화가 아니다.
 * 마스터도 같은 종의 이로치(졸업 보상)라 막지 않는다. 앞으로 종이 바뀔 일이 없으면
 * null — 돌을 지녀도 막을 게 없다. 알(부화)도 진화가 아니라서 null.
 */
function stoneCap(lineIndex, total) {
  const L = LINES[lineIndex % LINES.length];
  const s = stageFor(total);
  if (!L || s === 0) return null;
  for (let k = s + 1; k < STAGES.length; k++) {
    if (STAGES[k].key === "master") break;
    if (L.ids[k] !== L.ids[s]) return STAGES[k].at - 1;
  }
  return null;
}

/**
 * 상점이 사 주는 값(🪙) — 희귀도 × 진화 단계 × 이로치, 전설은 기본 15. 화면에 보일 값이다.
 * 실제로 주는 건 서버(server/src/wallet.js shopPrice)가 같은 셈으로 다시 센다.
 */
const STAR_COINS = { 1: 1, 2: 2, 3: 3, 4: 5, 5: 8 };
const STAGE_COINS = [0, 1, 1.5, 2, 3];
function shopPrice(lineIndex, total, shiny) {
  const L = LINES[lineIndex];
  const st = stageFor(total);
  if (!L || !st) return 0;
  const base = L.single && L.legendary ? 15 : STAR_COINS[rarityOf(lineIndex).stars];
  return Math.max(1, Math.round(base * STAGE_COINS[st] * (shiny ? 3 : 1)));
}

/** 다음 단계까지 얼마나 남았나 (마스터면 next: null) */
function progress(total) {
  const i = stageFor(total);
  const next = STAGES[i + 1];
  if (!next) return { ratio: 1, remaining: 0, next: null };
  const from = STAGES[i].at;
  return {
    ratio: Math.min(1, (total - from) / (next.at - from)),
    remaining: next.at - total,
    next: next.label,
  };
}

function describe(total, lineIndex = 0, opts = {}) {
  const L = LINES[lineIndex % LINES.length];
  const i = stageFor(total);
  if (L.single) return describeSingle(L, total, i, opts);
  return {
    line: L.line,
    name: L.names[i],
    stageIndex: i,
    stage: STAGES[i],
    dexId: L.ids[i],
    isEgg: STAGES[i].key === "egg",
    // 마스터는 보상으로 이로치가 되고, 부화 때 이로치로 태어난 개체는 처음부터 이로치다
    isShiny: STAGES[i].key === "master" || Boolean(opts.shiny),
    progress: progress(total),
  };
}

/**
 * 진화 없는 종. 부화·1차·최종이 같은 모습이라 단계 이름 대신 "전설의 포켓몬" 같은 이름을 쓰고,
 * 다음 목표는 곧장 마스터(이로치)다. stageIndex 도 마스터 전까지 1 로 둔다 — 알림이 레벨이
 * 오를 때마다 "진화했다"고 하지 않게(notify 는 stageIndex 가 오르면 진화로 본다).
 * 크기는 다 자란 모습(final)으로 그린다.
 */
function describeSingle(L, total, i, opts) {
  const master = STAGES[i].key === "master";
  const label = master ? STAGES[4].label : L.mythical ? "환상의 포켓몬" : L.legendary ? "전설의 포켓몬" : "진화 없음";
  const from = STAGES[1].at;
  const to = STAGES[4].at;
  return {
    line: L.line,
    name: L.names[i],
    stageIndex: master ? 4 : 1,
    stage: { ...STAGES[i], key: master ? "master" : i === 0 ? "egg" : "final", label },
    dexId: L.ids[i],
    isEgg: i === 0,
    isShiny: master || Boolean(opts.shiny),
    single: true,
    progress: master
      ? { ratio: 1, remaining: 0, next: null }
      : { ratio: Math.max(0, Math.min(1, (total - from) / (to - from))), remaining: to - total, next: "마스터(이로치)" },
  };
}

/**
 * 진화 트리. 같은 종이 연속으로 나오는 칸은 합친다.
 *
 * 2단 진화 라인은 '1차'와 '최종'이 같은 종이라 그대로 그리면
 * 같은 그림이 두 번 나온다. 종이 바뀌는 지점만 노드로 만든다.
 * 마스터는 종이 같아도 이로치라 항상 따로 세운다.
 */
function evolutionTree(lineIndex, total) {
  const L = LINES[lineIndex % LINES.length];
  const now = stageFor(total);
  const nodes = [];

  for (let i = 1; i < STAGES.length; i++) {
    const dexId = L.ids[i];
    const isShiny = STAGES[i].key === "master";
    const prev = nodes[nodes.length - 1];
    if (prev && prev.dexId === dexId && !isShiny) {
      // 같은 종이 이어진다 — 노드를 늘리지 않고 도달 여부만 갱신한다
      prev.reached = prev.reached || total >= STAGES[i].at;
      continue;
    }
    nodes.push({
      name: L.names[i],
      dexId,
      isShiny,
      at: STAGES[i].at,
      stageIndex: i,
      reached: total >= STAGES[i].at,
      current: i === now,
    });
  }

  // 합쳐진 칸 때문에 current가 사라질 수 있다. 도달한 마지막 노드를 현재로 본다.
  if (!nodes.some((n) => n.current)) {
    const last = [...nodes].reverse().find((n) => n.reached);
    if (last) last.current = true;
  }
  return nodes;
}

const BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";

/**
 * 스프라이트를 받아 디스크에 캐시한다. 오프라인에서도 떠야 한다.
 *
 * kind "still" — 정적 PNG. 트레이 아이콘용(nativeImage는 GIF를 움직이지 못한다)
 * kind "anim"  — 5세대 흑백 애니메이션 GIF. 팝오버·펫용
 */
async function spritePath(dexId, cacheDir, { kind = "still", shiny = false } = {}) {
  if (!dexId) return null;
  fs.mkdirSync(cacheDir, { recursive: true });
  const name = `${dexId}${shiny ? "-shiny" : ""}.${kind === "anim" ? "gif" : "png"}`;
  const file = path.join(cacheDir, kind === "anim" ? `anim-${name}` : name);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;

  const url =
    kind === "anim"
      ? `${BASE}/versions/generation-v/black-white/animated/${shiny ? "shiny/" : ""}${dexId}.gif`
      : `${BASE}/${shiny ? "shiny/" : ""}${dexId}.png`;

  // 타임아웃이 없으면 네트워크가 먹통일 때 호출부가 영영 resolve되지 않는다.
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`스프라이트 실패 ${url}: HTTP ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/**
 * 이로치가 없는 종도 있다. 실패하면 일반 스프라이트로 떨어진다.
 *
 * 실패를 조용히 삼키면 안 된다 — GIF가 안 받아지는데도 앱은 멀쩡해 보이고,
 * 정적 이미지가 뜨는 이유를 아무도 알 수 없게 된다.
 */
async function spriteWithFallback(mon, cacheDir, kind) {
  if (!mon.dexId) return null;
  if (mon.isShiny) {
    try { return await spritePath(mon.dexId, cacheDir, { kind, shiny: true }); }
    catch (e) { console.error("[sprite] 이로치 실패 " + mon.dexId + " " + kind + ": " + e.message); }
  }
  try { return await spritePath(mon.dexId, cacheDir, { kind }); }
  catch (e) { console.error("[sprite] 실패 " + mon.dexId + " " + kind + ": " + e.message); return null; }
}

module.exports = { STAGES, LINES, NATURES, RARITY, SHINY_BASE, rarityOf, rollChance, roll, rollAtLeast, rollWild, isSingle, shopPrice, rollShiny, rollNature, stageFor, stoneCap, progress, describe, evolutionTree, spritePath, spriteWithFallback };
