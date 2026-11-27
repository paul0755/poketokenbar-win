"use strict";
/**
 * 🎖️ 칭호 — 해낸 일로 저절로 얻고, 얻은 것 중 하나를 골라 이름 앞에 단다(길드 · 방 이름표 · 레이드 · 실시간 결투).
 *
 * 한 번 얻으면 없어지지 않는다(save.titles 에 얻은 시각). 조건은 지금 세이브로 다시 세므로, 이 기능이 생기기 전에
 * 해 둔 일(배지 · 졸업 · 도감 …)도 처음 켤 때 바로 들어온다. 레이드 막타(save.lastHits) · 방 꾸미기(save.decoN)처럼
 * 따로 세야 하는 것만 이때부터 센다.
 *
 * 남에게는 번호(id)만 보낸다 — 받은 쪽 앱이 이 표로 그림과 이름을 붙인다. 아무 글자나 칭호로 달아 보낼 수 없게.
 * 그래서 번호는 바꾸지 않는다(이름 · 그림은 바꿔도 된다). 표에 없는 번호는 안 보인다
 */

/** 순서 = 칭호 화면의 순서. n 은 조건에 쓸 숫자(ctx 의 열쇠), at 은 문턱 */
const DEFS = [
  { id: "lasthit", icon: "🗡️", name: "막타 장인", n: "lastHits", at: 1, desc: "레이드 보스에게 마지막 한 방" },
  { id: "bosskill", icon: "🐉", name: "보스 사냥꾼", n: "lastHits", at: 10, desc: "레이드 보스 막타 10번" },
  { id: "deco", icon: "🛋️", name: "집꾸미기 장인", n: "deco", at: 10, desc: "방 꾸미기 10번(배경 · 가구 사기 · 놓기 · 옮기기)" },
  { id: "deco50", icon: "🏡", name: "인테리어 중독", n: "deco", at: 50, desc: "방 꾸미기 50번" },
  { id: "badge1", icon: "🔰", name: "새내기 트레이너", n: "badges", at: 1, desc: "체육관 배지 1개" },
  { id: "badge8", icon: "🏅", name: "배지 콜렉터", n: "badges", at: 8, desc: "체육관 배지 8개 모두" },
  { id: "champ", icon: "🏆", name: "챔피언", n: "champ", at: 1, desc: "챔피언 로드에서 챔피언이 되기" },
  { id: "champ10", icon: "🌟", name: "살아있는 전설", n: "champ", at: 10, desc: "챔피언 10번" },
  { id: "dex50", icon: "📖", name: "도감 꿈나무", n: "dex", at: 50, desc: "도감 50종" },
  { id: "dex150", icon: "📚", name: "걸어다니는 도감", n: "dex", at: 150, desc: "도감 150종" },
  { id: "shiny1", icon: "✨", name: "반짝반짝", n: "shiny", at: 1, desc: "색이 다른 아이 1마리(박스)" },
  { id: "shiny5", icon: "💫", name: "이로치 헌터", n: "shiny", at: 5, desc: "색이 다른 아이 5마리(박스)" },
  { id: "legend1", icon: "⭐", name: "전설과 함께", n: "legend", at: 1, desc: "전설의 포켓몬 1마리(박스)" },
  { id: "legend5", icon: "🌌", name: "전설 수집가", n: "legend", at: 5, desc: "전설의 포켓몬 5마리(박스)" },
  { id: "mega", icon: "💎", name: "메가 진화자", n: "mega", at: 1, desc: "메가스톤을 지닌 아이 1마리" },
  { id: "grad1", icon: "🎓", name: "첫 졸업식", n: "grads", at: 1, desc: "포켓몬 1마리 졸업" },
  { id: "grad20", icon: "🏫", name: "명예 교장", n: "grads", at: 20, desc: "포켓몬 20마리 졸업" },
  { id: "win10", icon: "🥊", name: "결투 입문", n: "wins", at: 10, desc: "결투 10승" },
  { id: "win100", icon: "⚔️", name: "결투의 신", n: "wins", at: 100, desc: "결투 100승" },
  { id: "weektop", icon: "👑", name: "토큰왕", n: "weekTop", at: 1, desc: "길드 주간 1위" },
  { id: "weektop5", icon: "💸", name: "토큰 재벌", n: "weekTop", at: 5, desc: "길드 주간 1위 5번" },
  { id: "tok1e8", icon: "🔥", name: "1억 토큰 클럽", n: "tokens", at: 1e8, desc: "누적 토큰 1억" },
  { id: "tok1e9", icon: "🌋", name: "10억 토큰 클럽", n: "tokens", at: 1e9, desc: "누적 토큰 10억" },
];
const BY_ID = new Map(DEFS.map((d) => [d.id, d]));
const ID_RE = /^[a-z0-9]{1,16}$/;

/** 지금 조건을 넘긴 칭호를 save.titles 에 적는다. 새로 얻은 칭호 번호들을 돌려준다 */
function award(save, ctx, now = Date.now()) {
  save.titles = save.titles && typeof save.titles === "object" ? save.titles : {};
  const fresh = [];
  for (const d of DEFS) {
    if (save.titles[d.id] || (ctx[d.n] || 0) < d.at) continue;
    save.titles[d.id] = now;
    fresh.push(d.id);
  }
  return fresh;
}

/** 화면에 넘길 칭호 — 모두(얻은 것 · 못 얻은 것과 지금 몇인지)와 달고 있는 것 */
function view(save, ctx) {
  const got = save.titles || {};
  return {
    on: got[save.title] ? save.title : null,
    list: DEFS.map((d) => ({ id: d.id, icon: d.icon, name: d.name, desc: d.desc, at: d.at, now: Math.min(ctx[d.n] || 0, d.at), got: got[d.id] || null })),
  };
}

/** 단다(얻은 것만) · 뗀다(null) */
function wear(save, id) {
  if (id == null || id === "") { save.title = null; return { ok: true, on: null }; }
  if (!BY_ID.has(id) || !(save.titles || {})[id]) return { ok: false, reason: "아직 얻지 못한 칭호입니다" };
  save.title = id;
  return { ok: true, on: id };
}

/** 남에게 보낼 번호 — 달고 있고 얻은 것만 */
const worn = (save) => (save.title && (save.titles || {})[save.title] && BY_ID.has(save.title) ? save.title : "");

module.exports = { DEFS, BY_ID, ID_RE, award, view, wear, worn };
