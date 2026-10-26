"use strict";
/**
 * 미니룸 — 내 방을 꾸미고 포켓몬을 둔다.
 *
 * ── 무엇이 어디서 오나 ──
 *   배경(벽지·바닥)   상점처럼 사탕으로 산다. 오두막은 처음부터 있다
 *   가구              사탕으로 산다. 산 가구는 놓거나 치울 수 있다
 *   코인 꾸미기       코인(🪙)으로만 사는 배경·가구(deco.json — 서버와 같은 파일). 산 것은
 *                     서버 지갑이 기억하고 여기(coin)는 그 목록을 받아 둔 것이다. 세이브를
 *                     고쳐 넣어도 길드 방에는 안 보인다(서버가 지갑과 맞춰 본다)
 *   기록 장식         사지 않는다. 키운 기록이 쌓이면 저절로 생긴다
 *                     (도감 액자, 결투 배지 진열장, 졸업 트로피)
 *   포켓몬            박스에서 최대 MAX_MONS 마리를 고른다
 *   자리(pos)         가구를 끌어 옮긴 자리 — { id: [x, y] } 그림 좌표(320×200)의 왼쪽 위.
 *                     없으면 가구마다 정해 둔 자리(코인 가구는 빈자리를 찾는다)
 *   이름표(tags)      방의 포켓몬 이름표를 늘 보인다
 *
 * 그림은 렌더러(room.js)가 그린다. 여기서는 무엇을 가졌고 무엇을 놓았는지만 다룬다.
 * 값은 렌더러가 보낸 것을 믿지 않고 카탈로그에 있는 것만 받는다.
 */

const THEMES = [
  { id: "cabin", name: "오두막", icon: "🪵", cost: 0 },
  { id: "beach", name: "바닷가", icon: "🏖️", cost: 4 },
  { id: "night", name: "밤하늘", icon: "🌙", cost: 4 },
  { id: "lab", name: "연구소", icon: "🧪", cost: 4 },
  { id: "snow", name: "눈 오는 산장", icon: "❄️", cost: 4 },
  { id: "cave", name: "수정 동굴", icon: "💎", cost: 5 },
];

const FURNI = [
  { id: "window", name: "창문", icon: "🪟", cost: 0, desc: "창밖은 배경마다 다르다" },
  { id: "lamp", name: "스탠드 램프", icon: "💡", cost: 2, desc: "밤이 되면 더 밝게 켜진다" },
  { id: "rug", name: "둥근 러그", icon: "⭕", cost: 2, desc: "방 한가운데 깐다" },
  { id: "cushion", name: "몬스터볼 쿠션", icon: "🔴", cost: 2, desc: "작은 아이가 올라앉아 쉰다" },
  { id: "plant", name: "나무열매 화분", icon: "🪴", cost: 2, desc: "아이들이 와서 열매를 먹는다" },
  { id: "shelf", name: "기술머신 책장", icon: "💿", cost: 3, desc: "디스크가 꽂힌 책장" },
  { id: "bed", name: "침대", icon: "🛏️", cost: 4, desc: "밤이 되면 누군가 올라가 잔다" },
  { id: "desk", name: "책상과 컴퓨터", icon: "🖥️", cost: 4, desc: "화면에 코드가 떠 있다" },
  { id: "tv", name: "TV와 게임기", icon: "📺", cost: 3, desc: "모여서 구경한다" },
  { id: "aquarium", name: "어항", icon: "🐟", cost: 4, desc: "물고기가 헤엄친다" },
  { id: "poster", name: "산 풍경 포스터", icon: "🖼️", cost: 1, desc: "벽에 붙인다" },
];

const DECO = require("./deco.json");
const COIN_THEMES = DECO.themes;
const COIN_FURNI = DECO.furni;
const isCoin = (id) => COIN_THEMES.some((d) => d.id === id) || COIN_FURNI.some((d) => d.id === id);

const MAX_MONS = 5;

/** 처음 상태. 세이브에 없으면 이걸로 채운다 */
const fresh = () => ({ theme: "cabin", themes: ["cabin"], owned: ["window"], coin: [], off: [], mons: null, pos: {}, tags: false });

/** 옮길 수 있는 가구 — 바닥에 서는 사탕 가구와 코인 가구 전부(창문 · 러그 · 포스터는 벽지에 그려져 있다) */
const MOVABLE = ["lamp", "bed", "aquarium", "tv", "desk", "shelf", "plant", "cushion", ...DECO.furni.map((d) => d.id)];
const okPos = (v) => Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 320);

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
  r.coin = keep(r.coin, [...COIN_THEMES, ...COIN_FURNI], []);
  r.off = keep(r.off, [...FURNI, ...COIN_FURNI], []).filter((id) => r.owned.includes(id) || r.coin.includes(id));
  if (!r.themes.includes(r.theme) && !r.coin.includes(r.theme)) { r.theme = "cabin"; dirty = true; }
  if (r.mons != null && !Array.isArray(r.mons)) { r.mons = null; dirty = true; }
  const pos = r.pos && typeof r.pos === "object" && !Array.isArray(r.pos) ? r.pos : {};
  const cleanPos = Object.fromEntries(Object.entries(pos).filter(([id, v]) => MOVABLE.includes(id) && okPos(v)));
  if (JSON.stringify(cleanPos) !== JSON.stringify(r.pos)) { r.pos = cleanPos; dirty = true; }
  if (typeof r.tags !== "boolean") { r.tags = false; dirty = true; }
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

module.exports = { THEMES, FURNI, COIN_THEMES, COIN_FURNI, isCoin, MOVABLE, okPos, MAX_MONS, fresh, normalize, monsIn };
