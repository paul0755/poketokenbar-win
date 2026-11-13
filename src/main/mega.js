"use strict";
/**
 * 💎 메가진화 — 메가스톤을 지닌 아이가 싸움에 나오면 ⚡ 메가 에너지 하나로 그 판 동안 메가진화한다.
 *
 * 폼은 mega.json(54종) — 원작 메가진화 46종 + Z-A 의 새 메가 8종 가운데 이 앱에 있는 종(1~5세대)만.
 * 엘레이드 · 눈여아는 이 앱의 614종에 없어서 빠졌다. 디지털 월드에는 없다.
 *
 * ── 무엇이 바뀌나 ──
 * 타입과 종족값(HP 빼고 — 원작도 메가진화로 HP 종족값은 그대로다). 개체값 · 성격 · 레벨 · 기술은 그대로.
 * 특성은 결투 규칙에 없어서(battle.js 머리말) 바뀌는 특성은 화면에만 적는다.
 * 그림은 Showdown 의 3D 모델(pokemon.js 의 kind "3d" · "3dback")로 바뀐다 — 흑백 도트에는 메가가 없다.
 *
 * ── 규칙 ──
 *   메가스톤은 지닌 물건 칸 하나를 쓴다(변하지않는돌 · 빛가림돌과 같은 칸). 상점 🍬STONE_PRICE
 *   그 라인의 아이면 진화 전에도 지닐 수 있고, 메가진화는 그 종(리자몽 등)이 되었을 때만
 *   한 판에서 한 쪽은 한 번에 하나만 메가진화해 있다. 메가진화한 아이가 쓰러지면 다음 아이가 할 수 있다
 *   ⚡ 메가 에너지 — 토큰 PER_CHARGE 마다 하나, MAX 개까지. 메가진화 한 번에 하나
 *   친선 · 실시간 · 길드 결투는 에너지를 쓰지 않는다 — 두 PC 가 같은 판을 돌려야 하는데 상대의 에너지는 모른다
 */
const FORMS = require("./mega.json");
const profile = require("./profile");

const PER_CHARGE = 50_000_000;
const MAX = 5;
const STONE_PRICE = 10;
const PET_MINUTES = 10; // 바탕화면 펫 — 버닝 타임에 10분 안에 PET_TOKENS 를 쓰면 10분 동안 메가진화
const PET_TOKENS = 5_000_000;

const itemOf = (f) => "mega-" + f.stone;
const BY_ITEM = new Map(FORMS.map((f) => [itemOf(f), f]));
const BY_KEY = new Map(FORMS.map((f) => [f.key, f]));
const BY_DEX = new Map();
for (const f of FORMS) BY_DEX.set(f.dex, [...(BY_DEX.get(f.dex) || []), f]);

/** 지닌 물건 id(mega-charizard-x) → 폼. 메가스톤이 아니면 null */
const stoneForm = (item) => BY_ITEM.get(String(item || "")) || null;
const isStone = (item) => BY_ITEM.has(String(item || ""));
const byKey = (key) => BY_KEY.get(String(key || "")) || null;
/** 그 종의 메가 폼들 — 리자몽 · 뮤츠는 X · Y 둘 */
const formsOf = (dexId) => BY_DEX.get(Number(dexId)) || [];
const hasMega = (dexId) => BY_DEX.has(Number(dexId));

/** 지닌 돌로 지금 모습(dexId)이 메가진화할 수 있으면 그 폼 */
function formFor(hold, dexId) {
  const f = stoneForm(hold);
  return f && f.dex === Number(dexId) ? f : null;
}

/** 진화 라인(ids)에 그 돌의 종이 있나 — 파이리도 리자몽나이트를 미리 지닐 수 있다 */
const lineFits = (ids, item) => {
  const f = stoneForm(item);
  return Boolean(f && (ids || []).includes(f.dex));
};

/**
 * 싸우는 아이(battle.fighter 의 꼴)를 메가진화시킨다 — 타입 · 능력치(HP 빼고) · 이름.
 * 랭크 · 상태이상 · 체력은 그대로. megaId 는 그림(Showdown 폼 번호)
 */
function evolve(f, form) {
  const st = profile.statsOf(f.dexId, f.level, f.ivs, f.nature, form.base);
  if (!st) return false;
  f.preName = f.name;
  f.types = [...form.types];
  f.stats = { ...st, hp: f.stats.hp };
  f.name = form.name;
  f.mega = form.key;
  f.megaId = form.id;
  return true;
}

module.exports = { FORMS, PER_CHARGE, MAX, STONE_PRICE, PET_MINUTES, PET_TOKENS, itemOf, stoneForm, isStone, byKey, formsOf, hasMega, formFor, lineFits, evolve };
