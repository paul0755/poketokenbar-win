"use strict";
/**
 * 미니룸 — 내 방을 꾸미고 포켓몬을 둔다.
 *
 * ── 무엇이 어디서 오나 ──
 *   배경(벽지·바닥)   상점처럼 사탕으로 산다. 오두막은 처음부터 있다
 *   가구              사탕으로 산다. 산 가구는 놓거나 치울 수 있다
 *   기록 장식         사지 않는다. 키운 기록이 쌓이면 저절로 생긴다
 *                     (도감 액자, 결투 배지 진열장, 졸업 트로피)
 *   포켓몬            박스에서 최대 MAX_MONS 마리를 고른다
 *
 * 그림은 렌더러(room.js)가 그린다. 여기서는 무엇을 가졌고 무엇을 놓았는지만 다룬다.
 * 값은 렌더러가 보낸 것을 믿지 않고 카탈로그에 있는 것만 받는다.
 */

const THEMES = [
  { id: "cabin", name: "오두막", icon: "🪵", cost: 0 },
  { id: "beach", name: "바닷가", icon: "🏖️", cost: 4 },
  { id: "night", name: "밤하늘", icon: "🌙", cost: 4 },
  { id: "lab", name: "연구소", icon: "🧪", cost: 4 },
];

const FURNI = [
  { id: "window", name: "창문", icon: "🪟", cost: 0, desc: "창밖은 배경마다 다르다" },
  { id: "lamp", name: "스탠드 램프", icon: "💡", cost: 2, desc: "밤하늘 배경에서 더 밝다" },
  { id: "rug", name: "둥근 러그", icon: "⭕", cost: 2, desc: "방 한가운데 깐다" },
  { id: "cushion", name: "몬스터볼 쿠션", icon: "🔴", cost: 2, desc: "작은 아이 하나가 올라앉아 쉰다" },
  { id: "plant", name: "나무열매 화분", icon: "🪴", cost: 2, desc: "열매가 셋 달렸다" },
  { id: "shelf", name: "기술머신 책장", icon: "💿", cost: 3, desc: "디스크가 꽂힌 책장" },
];

const MAX_MONS = 5;

/** 처음 상태. 세이브에 없으면 이걸로 채운다 */
const fresh = () => ({ theme: "cabin", themes: ["cabin"], owned: ["window"], off: [], mons: null });

/** 옛 세이브·깨진 값을 바로잡는다. 고친 게 있으면 true */
function normalize(save) {
  const r = save.room && typeof save.room === "object" ? save.room : null;
  if (!r) {
    save.room = fresh();
    return true;
  }
  let dirty = false;
  const keep = (arr, list, base) => {
    const v = [...new Set([...(Array.isArray(arr) ? arr : []), ...base])].filter((id) => list.some((x) => x.id === id));
    if (JSON.stringify(v) !== JSON.stringify(arr)) dirty = true;
    return v;
  };
  r.themes = keep(r.themes, THEMES, ["cabin"]);
  r.owned = keep(r.owned, FURNI, ["window"]);
  r.off = keep(r.off, FURNI, []).filter((id) => r.owned.includes(id));
  if (!r.themes.includes(r.theme)) { r.theme = "cabin"; dirty = true; }
  if (r.mons != null && !Array.isArray(r.mons)) { r.mons = null; dirty = true; }
  return dirty;
}

/**
 * 방에 둘 아이들. 고른 적이 없으면(mons == null) 키우는 아이와 바탕화면 펫으로 채운다 —
 * 처음 연 방이 비어 있으면 무엇을 하는 탭인지 알 수 없다. 사라진 아이·알은 뺀다.
 */
function monsIn(save, isEgg) {
  const ok = (id) => {
    const m = (save.box || []).find((x) => x.id === id);
    return m && !isEgg(m);
  };
  const r = save.room;
  const base = r.mons != null ? r.mons : [save.activeId, ...(save.petIds || []), ...(save.box || []).map((m) => m.id)];
  return [...new Set(base)].filter(ok).slice(0, MAX_MONS);
}

module.exports = { THEMES, FURNI, MAX_MONS, fresh, normalize, monsIn };
