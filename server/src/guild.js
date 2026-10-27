/**
 * 길드 — 길드원들의 방과 포켓몬을 모아 두는 곳. 길드 코드 하나에 Durable Object 하나.
 *
 * 실시간 배틀 방(Room)과 달리 저장한다. 길드원이 꺼져 있어도 방을 구경하고 결투할 수
 * 있어야 하기 때문이다. 저장하는 건 앱이 올린 "방 사진"(snap)뿐이다 — 트레이너 이름,
 * 방 꾸미기, 방에 둔 포켓몬, 도감·졸업·승수, 대표 팀 코드, 그리고 공개를 켠 사람만
 * 이번 주·오늘 토큰 합계(길드 순위). 토큰 사용 기록(로그) 자체는 오지 않는다.
 *
 * ── 계정 없이 ──
 * 들어올 때 서버가 길드원 번호(memberId)와 열쇠(key)를 준다. 앱은 세이브에 둔다.
 * 서버는 열쇠의 해시만 갖고 있어서, 저장소가 새도 남의 칸을 고칠 수 없다.
 * 만든 사람이 길드장 — 내보내기 · 길드 없애기. 길드장이 나가면 가장 오래된 길드원이 맡는다.
 *
 * ── 주소 (index.js 가 넘겨준다) ──
 *   POST /guild                    만들기   { name, member }        → { code, memberId, key }
 *   GET  /guild/ABCD2345           보기                              → { name, leader, members[] }
 *   POST /guild/ABCD2345/join      들어가기 { member }              → { memberId, key }
 *   POST /guild/ABCD2345/update    내 방 올리기 { memberId, key, member, walletKey? } → { walletOk }
 *   POST /guild/ABCD2345/leave     나가기   { memberId, key }        — 내 칸은 바로 지운다
 *   POST /guild/ABCD2345/kick      내보내기 { memberId, key, target } (길드장)
 *   POST /guild/ABCD2345/disband   길드 없애기 { memberId, key }    (길드장)
 *   GET  /guilds                   길드 목록 (directory.js)          → { guilds[] }
 *
 * ── 주간 기록 (명예의 전당) ──
 * 길드원이 토큰 합계를 올릴 때마다 그 주(weekKey) 칸에 마지막 값을 적어 둔다("wk:2026-10-19").
 * 그래야 일요일 밤 앱이 꺼져 있던 사람의 숫자도 다음 주에 남아 지난주 순위를 확정할 수 있다.
 * 앱은 지난주 최종 합계(usage.prev)도 같이 보낸다 — 주가 바뀌기 직전 몇 분이나 앱이 꺼져 있던
 * 동안 쓴 몫까지 넣어 지난주 칸을 마무리한다.
 * 최근 KEEP_WEEKS 주만 둔다. 길드를 나가거나 내보내지면 그 사람의 줄은 모든 주에서 지운다.
 * 순위·칭호는 앱이 이 기록으로 계산한다 — 서버는 적어 두기만 한다.
 * 끝난 주는 고칠 수 없다 — "이번 주"는 서버 시각으로 지금인 주만, 지난주는 마무리(prev)로만 받는다.
 *
 * ── 주간 코인 보상 ──
 * 지난주가 확정되면(다음 주가 시작하고 36시간 뒤 — 늦게 켠 사람의 마무리를 기다린다) 1위에게
 * 🪙REWARD_TOP, 칭호마다 🪙REWARD_TITLE 을 그 사람 지갑에 한 번 넣는다.
 *
 * 보상은 "확인된 지갑"(m.wallet)에만 넣는다 — 방 사진의 지갑 번호(snap.walletId)는 남의 것을
 * 적어 낼 수 있어서, 부계정이 받을 보상을 본계정 지갑으로 몰 수 있었다. 앱이 지갑 열쇠를 같이
 * 보내면 그 지갑이 정말 이 사람 것인지 보고 묶는다. 한 길드에서 지갑 하나는 한 사람에게만.
 * 아직 지갑이 확인되지 않은 사람의 보상은 버리지 않고 PENDING_DAYS 동안 기다린다.
 * 지갑 하나는 한 주에 길드 하나에서만 보상을 받는다 — 길드 코드와 주를 같이 넘기고, 그 주 보상을
 * 이미 다른 길드에서 받은 지갑이면 지갑이 거절한다(409, wallet.js). 거절된 보상은 넘긴다.
 *
 * ── 공동 목표 ──
 * 주마다 길드 합계 목표가 셋(🥉 🥈 🥇) — 최근 GOAL_WEEKS 주 합계 평균의 GOAL_TIERS 배. 기록이
 * 없으면 공개한 길드원 수 × GOAL_BASE. 목표는 그 주가 시작된 뒤 처음 셀 때 정해 두고("goal:주")
 * 그 주 안에는 바꾸지 않는다. 합계는 공개한 사람(주간 기록에 줄이 있는 사람)만 센다.
 * 주가 확정되면 이룬 만큼 GOAL_COINS 를, 그 주에 토큰을 쓴 길드원(그 주가 시작하기 전부터
 * 길드원이었던 사람) 모두에게 넣는다.
 *
 * ── 홀 꾸미기 (모금) ──
 * 장식(src/main/hall.json — 앱과 같은 파일)마다 모금함이 있다. 길드원 누구나 코인을 넣고,
 * 다 차면 홀에 놓인다. 넣은 코인은 돌려받지 않는다(길드를 나가도 길드에 남는다).
 * 홀 배경(theme)이 다 모이면 처음 것은 바로 바르고, 그다음부터는 길드장이 고른다.
 *   POST /guild/ABCD2345/hall/donate  { memberId, key, walletId, walletKey, item, amount }
 *   POST /guild/ABCD2345/hall/theme   { memberId, key, theme }   (길드장, "stone" 은 기본 돌 홀)
 *
 * ── 코인 꾸미기 ──
 * 코인으로 산 배경·가구(wallet.js buy)는 산 사람 방에만 보여야 한다. 방 사진을 받을 때 지갑의
 * 산 목록과 맞춰 보고 안 산 것은 지운다(checkDeco). 지갑 번호는 길드 보기에 드러나 있어서
 * 남의 지갑 번호를 적어 낼 수 있다 — 그래서 지갑 열쇠(walletKey)도 받아 그 지갑이 이 사람
 * 것인지 본다. 열쇠는 저장하지 않는다.
 *
 * ── 길드 목록 ── directory.js
 * 길드장이 "목록에 올리기"를 켜면 길드 요약(이름 · 소개 · 인원 · 길드장 이름 · 이번 주 활동한 인원 ·
 * 홀 장식 수)을 목록에 올린다. 코드를 몰라도 목록에서 골라 들어온다. 사람이 들고 나거나 설정을
 * 바꾸면 바로, 방을 올릴 때는 PUBLISH_GAP_MS 에 한 번 고친다. 끄거나 길드가 없어지면 내린다.
 *   POST /guild/ABCD2345/listing   { memberId, key, listed, intro }   (길드장)
 *
 * ── 길드 몰 ── market.js
 */
import { marketView, marketAction, returnListingsOf, listings } from "./market.js";
import { WALLET_ID, walletCall, DECO_ITEMS, DECO_THEMES } from "./wallet.js";
import LINES from "../../src/main/lines.json" with { type: "json" };
import HALL from "../../src/main/hall.json" with { type: "json" };
import { directoryCall } from "./directory.js";

const HALL_ITEMS = new Map(HALL.items.map((it) => [it.id, it]));

// 전설 석상에 깎을 수 있는 도감 번호 — 전설 · 환상만
const LEGEND_DEX = new Set(LINES.filter((l) => l.single && l.legendary).map((l) => l.ids[1]));

export const MAX_MEMBERS = 30;
const UPDATE_GAP_MS = 15_000; // 내 방 올리기는 15초에 한 번까지
const KEEP_WEEKS = 26; // 반년치 주간 기록
export const REWARD_TOP = 50;
export const REWARD_TITLE = 10;
const PENDING_DAYS = 14; // 지갑이 아직 확인되지 않은 사람의 보상을 기다리는 날
export const GOAL_TIERS = [0.8, 1.0, 1.25]; // 🥉 🥈 🥇 — 평소(최근 평균)의 배
export const GOAL_COINS = [10, 20, 35];
const GOAL_WEEKS = 4;
const GOAL_BASE = 200_000_000; // 기록이 없을 때 공개한 길드원 한 명당
// 칭호 — 앱(guild.js TITLES)과 같아야 한다
const TITLE_KEYS = ["week", "burn", "core", "night", "dawn", "morning"];
const DAY_MS = 86_400_000;
const PUBLISH_GAP_MS = 10 * 60_000; // 방을 올릴 때 목록 요약은 10분에 한 번까지
const shiftDay = (key, days) => new Date(Date.parse(key + "T00:00:00Z") + days * DAY_MS).toISOString().slice(0, 10);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const fail = (reason, status = 400) => json({ ok: false, reason }, status);

async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

const str = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, n);
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const ID = /^[a-z]{1,16}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const big = (v) => (Number.isSafeInteger(v) && v >= 0 && v <= 1e13 ? v : 0); // 토큰 합계 — 넉넉히 10조까지

/**
 * 그 사람 PC 시간대의 이번 주 시작(월요일 0시) 시각. 앱이 보낸 값이 weekKey 와 맞으면(±1.5일)
 * 그대로 쓰고, 없거나 엉뚱하면 가장 이른 시간대(UTC+14)의 월요일 0시로 본다 — 가장 엄격한 쪽이다.
 */
function weekStartOf(u) {
  const base = Date.parse(u.weekKey + "T00:00:00Z");
  if (Number.isSafeInteger(u.weekStart) && Math.abs(u.weekStart - base) < 36 * 3_600_000) return u.weekStart;
  return base - 14 * 3_600_000;
}

/** 공개를 켠 길드원의 사용량 합계. 언제 기준인지(주·날)가 있어야 지난주 숫자를 거를 수 있다 */
function cleanUsage(u) {
  if (!u || typeof u !== "object" || !DAY.test(u.weekKey) || !DAY.test(u.dayKey)) return null;
  const p = u.prev && typeof u.prev === "object" && DAY.test(u.prev.weekKey) && u.prev.weekKey < u.weekKey ? u.prev : null;
  return {
    week: big(u.week), today: big(u.today), burn: big(u.burn),
    // 칭호용 시간대별 합계(이번 주) — 아침 6~10 · 코어 10~16 · 야근 18~24 · 새벽 0~6시
    morning: big(u.morning), core: big(u.core), night: big(u.night), dawn: big(u.dawn),
    weekKey: u.weekKey, dayKey: u.dayKey,
    weekStart: weekStartOf(u),
    // 지난주 최종 합계 — record 가 지난주 칸을 마무리한다
    prev: p ? { week: big(p.week), burn: big(p.burn), morning: big(p.morning), core: big(p.core), night: big(p.night), dawn: big(p.dawn), weekKey: p.weekKey } : null,
  };
}
const isId = (v) => typeof v === "string" && ID.test(v); // ID.test(undefined) 는 "undefined" 를 본다
const STAGES = ["baby", "mid", "final", "master"];

/**
 * 앱이 올린 방 사진을 꼴만 본다. 내용이 진짜인지는 알 수 없다(세이브는 그 사람 PC에 있다) —
 * 그래서 보상 없이 구경과 친선뿐이다. 모르는 칸은 버리고, 틀린 값은 빼고 받는다.
 */
/** 가구 자리 — { id: [x, y] } 그림 좌표(320×200). 가구는 24개까지 */
function cleanPos(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return {};
  const ok = (v) => Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 320);
  return Object.fromEntries(Object.entries(p).filter(([id, v]) => ID.test(id) && ok(v)).slice(0, 24));
}

export function cleanSnap(m) {
  if (!m || typeof m !== "object") return null;
  const trainer = str(m.trainer, 16);
  if (!trainer) return null;
  const mons = (Array.isArray(m.mons) ? m.mons : []).slice(0, 5).map((x) => ({
    line: int(x && x.line, 0, 2000),
    dexId: int(x && x.dexId, 1, 1100),
    name: str(x && x.name, 20),
    shiny: Boolean(x && x.shiny),
    stage: STAGES.includes(x && x.stage) ? x.stage : "baby",
    level: int(x && x.level, 1, 100) ?? 1,
  })).filter((x) => x.line != null && x.dexId != null && x.name);
  const team = typeof m.team === "string" && m.team.length <= 600 && /^PTB1-[A-Za-z0-9_-]+-[0-9a-z]{5}$/.test(m.team) ? m.team : "";
  const dex = m.dex && typeof m.dex === "object" ? m.dex : {};
  return {
    trainer,
    theme: isId(m.theme) ? m.theme : "cabin",
    furni: (Array.isArray(m.furni) ? m.furni : []).filter(isId).slice(0, 24),
    statue: LEGEND_DEX.has(m.statue) ? m.statue : null, // 전설 석상의 모델
    pos: cleanPos(m.pos), // 끌어 옮긴 가구 자리
    mons,
    dex: { seen: int(dex.seen, 0, 5000) ?? 0, total: int(dex.total, 0, 5000) ?? 0 },
    graduated: int(m.graduated, 0, 100000) ?? 0,
    lastGrad: str(m.lastGrad, 20),
    wins: int(m.wins, 0, 10_000_000) ?? 0,
    team,
    walletId: typeof m.walletId === "string" && WALLET_ID.test(m.walletId) ? m.walletId : "", // 주간 코인 보상을 넣을 곳
    usage: cleanUsage(m.usage),
    weekTop: int(m.weekTop, 0, 10000) ?? 0, // 주간 1위를 몇 번 했나 — 방의 메달 액자
  };
}

/** 지갑 열쇠가 맞으면 그 지갑의 정보, 아니면 null */
async function walletOf(env, snap, walletKey) {
  if (!snap.walletId || typeof walletKey !== "string") return null;
  const r = await walletCall(env, snap.walletId, "view", { key: walletKey });
  return r.ok ? r : null;
}

/** 코인 꾸미기 중 산 것만 남긴다(wv: walletOf 결과) */
function checkDeco(snap, wv) {
  const owned = (wv && wv.deco) || [];
  snap.furni = snap.furni.filter((id) => !DECO_ITEMS.has(id) || owned.includes(id));
  if (DECO_THEMES.has(snap.theme) && !owned.includes(snap.theme)) snap.theme = "cabin";
}

/** 그 주가 가장 이른 시간대(UTC+14)에서 시작한 때 — "그 주가 시작하기 전부터 길드원"을 엄격하게 본다 */
const weekBegin = (key) => Date.parse(key + "T00:00:00Z") - 14 * 3_600_000;
/** 시각 t 의 (UTC 날짜로 본) 월요일 */
const mondayOf = (t) => { const d = new Date(t); return new Date(t - ((d.getUTCDay() + 6) % 7) * DAY_MS).toISOString().slice(0, 10); };
const sumWeek = (wk) => Object.values((wk && wk.rows) || {}).reduce((n, r) => n + (r.week || 0), 0);

export class Guild {
  constructor(state, env) {
    this.state = state;
    this.store = state.storage;
    this.env = env;
  }

  async members() {
    const all = await this.store.list({ prefix: "m:" });
    return [...all.values()].sort((a, b) => a.joined - b.joined);
  }

  /** 열쇠가 맞는 길드원. 틀리면 null */
  async who(body) {
    const id = str(body.memberId, 40);
    if (!id || typeof body.key !== "string") return null;
    const m = await this.store.get("m:" + id);
    return m && m.keyHash === (await sha256(body.key)) ? m : null;
  }

  async add(snap, wv) {
    const id = "m" + randomHex(6);
    const key = randomHex(16);
    const now = Date.now();
    const wallet = await this.bindable(snap, wv, id);
    await this.store.put("m:" + id, { id, keyHash: await sha256(key), snap, wallet, joined: now, updated: now });
    return { memberId: id, key, walletOk: Boolean(wallet) };
  }

  /** 열쇠로 확인된 지갑을 이 사람에게 묶을 수 있나 — 다른 길드원에게 이미 묶였으면 안 된다 */
  async bindable(snap, wv, selfId) {
    if (!wv) return null;
    const taken = (await this.members()).some((m) => m.id !== selfId && m.wallet === snap.walletId);
    return taken ? null : snap.walletId;
  }

  /**
   * 그 주의 공동 목표 — 처음 셀 때 정해 두고 그 주 안에는 그대로 둔다. 아직 시작하지 않은 주는 null.
   * 최근 GOAL_WEEKS 주(그 주 앞) 합계 평균, 없으면 공개한 길드원 수 × GOAL_BASE
   */
  async goalFor(key) {
    const saved = await this.store.get("goal:" + key);
    if (saved) return saved;
    if (Date.now() < weekBegin(key)) return null;
    const past = [...(await this.store.list({ prefix: "wk:" })).values()]
      .filter((w) => w.key < key).sort((a, b) => (a.key < b.key ? 1 : -1)).slice(0, GOAL_WEEKS)
      .map(sumWeek).filter((n) => n > 0);
    const sharing = (await this.members()).filter((m) => m.snap && m.snap.usage).length;
    const base = past.length ? past.reduce((a, b) => a + b, 0) / past.length : Math.max(1, sharing) * GOAL_BASE;
    const goal = { key, base: Math.round(base), tiers: GOAL_TIERS.map((t) => Math.round(base * t)), at: Date.now() };
    await this.store.put("goal:" + key, goal);
    const keys = [...(await this.store.list({ prefix: "goal:" })).keys()].sort();
    if (keys.length > KEEP_WEEKS) await this.store.delete(keys.slice(0, keys.length - KEEP_WEEKS));
    return goal;
  }

  /** 화면에 보일 목표 — 지금 진행 중일 수 있는 주들(시간대마다 다르다)과 최근 기록이 있는 주 */
  async goals() {
    const now = Date.now();
    const recent = [...(await this.store.list({ prefix: "wk:" })).values()].map((w) => w.key).sort().slice(-2);
    const keys = [...new Set([mondayOf(now + 14 * 3_600_000), mondayOf(now - 12 * 3_600_000), ...recent])];
    const out = {};
    for (const key of keys) {
      const g = await this.goalFor(key);
      if (!g) continue;
      const total = sumWeek(await this.store.get("wk:" + key));
      out[key] = { tiers: g.tiers, total, reached: g.tiers.filter((t) => total >= t).length };
    }
    return out;
  }

  async hall() {
    return (await this.store.get("hall")) || { funds: {}, owned: [], donors: {}, theme: null };
  }

  /** 화면에 보일 홀 — 모금함마다 넣은 사람(많이 넣은 순) */
  publicHall(h) {
    const donors = {};
    for (const [item, byMember] of Object.entries(h.donors || {})) {
      donors[item] = Object.values(byMember).sort((a, b) => b.coins - a.coins).map(({ trainer, coins }) => ({ trainer, coins }));
    }
    return { funds: h.funds, owned: h.owned, theme: h.theme, donors };
  }

  /**
   * 목록에 올린 길드면 요약을 고친다. force 가 아니면 PUBLISH_GAP_MS 에 한 번까지.
   * 목록을 부르는 사이 설정이 바뀌었을 수 있어서, 끝나고 다시 읽어 꺼졌으면 내린다
   */
  async publish(meta, force = false) {
    if (!meta || !meta.listed) return;
    const now = Date.now();
    if (!force && now - (meta.pubAt || 0) < PUBLISH_GAP_MS) return;
    const list = await this.members();
    if (!list.length) return;
    const lead = list.find((m) => m.id === meta.leader);
    const h = await this.hall();
    await directoryCall(this.env, "put", {
      code: meta.code,
      name: meta.name,
      intro: meta.intro || "",
      members: list.length,
      max: MAX_MEMBERS,
      leader: lead ? lead.snap.trainer : "",
      active: list.filter((m) => now - m.updated < 7 * DAY_MS).length, // 이번 주(7일) 안에 방을 올린 사람
      hall: h.owned.length,
      at: Math.max(...list.map((m) => m.updated)),
    });
    const cur = await this.store.get("meta");
    if (!cur) return;
    if (!cur.listed) await directoryCall(this.env, "remove", { code: meta.code });
    else await this.store.put("meta", { ...cur, pubAt: now });
  }

  /** 그 주 칸에 한 사람의 합계를 적는다. 같은 값이면 쓰지 않는다 */
  async writeWeek(weekKey, id, trainer, u) {
    const key = "wk:" + weekKey;
    const wk = (await this.store.get(key)) || { key: weekKey, rows: {} };
    const old = wk.rows[id];
    if (old && old.week === u.week && old.trainer === trainer) return;
    wk.rows[id] = { trainer, week: u.week, burn: u.burn, morning: u.morning, core: u.core, night: u.night, dawn: u.dawn, at: Date.now() };
    await this.store.put(key, wk);
  }

  /**
   * 이번 주 칸에 마지막 합계를 적고, 지난주 최종 합계(prev)로 지난주 칸을 마무리한다.
   * 지난주 칸은 지난주가 끝나기 전에 이미 길드원이었던 사람만 고칠 수 있다 — 이번 주에
   * 들어온 사람이 들어오기 전 주의 사용량으로 지난주 1위를 가져가면 안 된다.
   * "지난주가 끝난 때"는 그 사람 PC 의 월요일 0시(usage.weekStart)다.
   */
  async record(id, snap, joined) {
    const u = snap && snap.usage;
    if (!u) return;
    // 이번 주는 서버 시각으로 정말 지금인 주만 받는다 — 끝난 주를 "이번 주"라고 보내 고치지 못하게
    const now = Date.now();
    if (!(u.weekStart <= now + 3_600_000 && now - u.weekStart < 7 * DAY_MS + 3_600_000)) return;
    await this.writeWeek(u.weekKey, id, snap.trainer, u);
    // 지난주는 바로 앞 주만, 그 주가 끝나기 전에 이미 길드원이었던 사람만 마무리한다
    if (u.prev && u.prev.weekKey === shiftDay(u.weekKey, -7) && joined <= u.weekStart) await this.writeWeek(u.prev.weekKey, id, snap.trainer, u.prev);
    const keys = [...(await this.store.list({ prefix: "wk:" })).keys()].sort();
    if (keys.length > KEEP_WEEKS) await this.store.delete(keys.slice(0, keys.length - KEEP_WEEKS));
  }

  /** 나간 사람의 줄을 모든 주에서 지운다 */
  async forget(id) {
    for (const [key, wk] of await this.store.list({ prefix: "wk:" })) {
      if (!wk.rows || !wk.rows[id]) continue;
      delete wk.rows[id];
      if (Object.keys(wk.rows).length) await this.store.put(key, wk);
      else await this.store.delete(key);
    }
  }

  /**
   * 확정된 주의 코인 보상. 한 주에 한 번 — 줄 목록을 먼저 적어 두고(paid), 넣을 때마다 표시한다.
   * 지갑에 넣다 실패한 건 다음 보기 때 다시 넣는다.
   */
  async payWeeks() {
    const members = new Map((await this.members()).map((m) => [m.id, m]));
    const code = ((await this.store.get("meta")) || {}).code; // 지갑이 "그 주 보상을 준 길드"로 적는다
    for (const [key, wk] of await this.store.list({ prefix: "wk:" })) {
      const closedAt = Date.parse(shiftDay(wk.key, 7) + "T00:00:00Z") + 36 * 3_600_000;
      if (Date.now() < closedAt) continue;
      if (!wk.paid) {
        const rows = Object.entries(wk.rows || {}).map(([id, r]) => ({ id, ...r }));
        wk.rewards = [];
        for (const k of TITLE_KEYS) {
          const best = rows.reduce((a, r) => ((r[k] || 0) > (a ? a[k] || 0 : 0) ? r : a), null);
          if (best) wk.rewards.push({ id: best.id, title: k, coins: k === "week" ? REWARD_TOP : REWARD_TITLE, done: false });
        }
        // 공동 목표 — 이룬 만큼, 그 주에 쓴 사람 모두(그 주가 시작하기 전부터 길드원이었던 사람)
        const goal = await this.goalFor(wk.key);
        const total = sumWeek(wk);
        const tier = goal ? goal.tiers.filter((t) => total >= t).length : 0;
        wk.goal = { tiers: goal ? goal.tiers : [], total, reached: tier };
        if (tier) {
          for (const r of rows) {
            const m = members.get(r.id);
            if (r.week > 0 && m && m.joined <= weekBegin(wk.key)) wk.rewards.push({ id: r.id, title: "goal", coins: GOAL_COINS[tier - 1], done: false });
          }
        }
        wk.paid = true;
        await this.store.put(key, wk);
      }
      let dirty = false;
      for (const rw of wk.rewards || []) {
        if (rw.done) continue;
        const m = members.get(rw.id);
        const wallet = m && m.wallet; // 열쇠로 확인된 지갑에만
        if (!m || (!wallet && Date.now() > closedAt + PENDING_DAYS * DAY_MS)) { rw.done = true; rw.skipped = true; dirty = true; continue; } // 나갔거나 끝내 지갑을 확인하지 못했다
        if (!wallet) continue; // 앱이 지갑 열쇠를 보내 확인될 때까지 기다린다
        const what = rw.title === "week" ? "1위" : rw.title === "goal" ? `목표 ${["🥉", "🥈", "🥇"][GOAL_COINS.indexOf(rw.coins)] || ""}` : "칭호";
        const r = await walletCall(this.env, wallet, "credit", { amount: rw.coins, memo: `길드 주간 ${what} (${wk.key})`, guild: code, week: wk.key });
        if (r.ok || r.status === 404) { rw.done = true; dirty = true; }
        else if (r.status === 409) { rw.done = true; rw.skipped = true; dirty = true; } // 그 주 보상을 이미 다른 길드에서 받은 지갑
      }
      if (dirty) await this.store.put(key, wk);
    }
  }

  async weeks() {
    const all = await this.store.list({ prefix: "wk:" });
    return [...all.values()]
      .sort((a, b) => (a.key < b.key ? 1 : -1))
      .map((wk) => ({ key: wk.key, rows: Object.entries(wk.rows || {}).map(([id, r]) => ({ id, ...r })), rewards: (wk.rewards || []).filter((x) => x.done && !x.skipped).map(({ id, title, coins }) => ({ id, title, coins })), goal: wk.goal || null }));
  }

  async view(meta) {
    await this.payWeeks().catch(() => {});
    const list = await this.members();
    return json({
      ok: true,
      code: meta.code,
      name: meta.name,
      leader: meta.leader,
      listed: Boolean(meta.listed),
      intro: meta.intro || "",
      max: MAX_MEMBERS,
      members: list.map((m) => ({ id: m.id, snap: m.snap, joined: m.joined, updated: m.updated, walletOk: Boolean(m.wallet) })),
      weeks: await this.weeks(),
      goals: await this.goals(), // { 주: { tiers, total, reached } }
      goalCoins: GOAL_COINS,
      hall: this.publicHall(await this.hall()),
      now: Date.now(),
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.slice(1);
    const meta = await this.store.get("meta");

    if (request.method === "GET") {
      if (!meta) return fail("없는 길드입니다. 코드를 확인해 주세요", 404);
      return action === "market" ? marketView(this) : this.view(meta);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return fail("잘못된 요청입니다");
    }

    if (action === "create") {
      if (meta) return fail("이미 있는 코드", 409); // index.js 가 다른 코드로 다시 시도한다
      const name = str(body.name, 20);
      const snap = cleanSnap(body.member);
      if (!name) return fail("길드 이름을 넣어 주세요");
      if (!snap) return fail("트레이너 이름이 없습니다");
      const wv = await walletOf(this.env, snap, body.walletKey);
      checkDeco(snap, wv);
      const me = await this.add(snap, wv);
      const fresh = { code: str(body.code, 8), name, leader: me.memberId, created: Date.now(), listed: Boolean(body.listed), intro: str(body.intro, 60) };
      await this.store.put("meta", fresh);
      await this.record(me.memberId, snap, Date.now());
      await this.publish(fresh, true);
      return json({ ok: true, code: body.code, name, ...me, leader: true, listed: fresh.listed });
    }

    if (!meta) return fail("없는 길드입니다. 코드를 확인해 주세요", 404);

    if (action.startsWith("market/")) return marketAction(this, action.slice(7), body, meta);

    if (action === "join") {
      const snap = cleanSnap(body.member);
      if (!snap) return fail("트레이너 이름이 없습니다");
      if ((await this.members()).length >= MAX_MEMBERS) return fail(`길드가 꽉 찼습니다 (${MAX_MEMBERS}명)`, 403);
      const wv = await walletOf(this.env, snap, body.walletKey);
      checkDeco(snap, wv);
      const me = await this.add(snap, wv);
      await this.record(me.memberId, snap, Date.now());
      await this.publish(meta, true);
      return json({ ok: true, code: meta.code, name: meta.name, ...me, leader: false });
    }

    const me = await this.who(body);
    if (!me) return fail("길드원 열쇠가 맞지 않습니다. 이미 나갔거나 내보내졌을 수 있습니다", 403);

    if (action === "hall/donate") {
      const it = HALL_ITEMS.get(str(body.item, 24));
      const amount = Number(body.amount);
      if (!it) return fail("없는 장식입니다");
      if (!Number.isInteger(amount) || amount < 1 || amount > 100_000) return fail("🪙1 이상 넣어 주세요");
      if (!WALLET_ID.test(body.walletId || "") || typeof body.walletKey !== "string") return fail("지갑이 필요합니다");
      let h = await this.hall();
      if (h.owned.includes(it.id)) return fail("이미 다 모였습니다");
      const pay = Math.min(amount, it.coins - (h.funds[it.id] || 0)); // 남은 만큼만
      const paid = await walletCall(this.env, body.walletId, "debit", { key: body.walletKey, amount: pay, memo: `길드 홀 · ${it.name}` });
      if (!paid.ok) return fail(paid.reason || "코인을 내지 못했습니다", paid.status === 402 ? 402 : paid.status === 403 ? 403 : 400);
      // 지갑을 부르는 사이 다른 길드원이 넣었을 수 있다 — 다시 읽고, 넘친 만큼은 돌려준다
      h = await this.hall();
      const used = h.owned.includes(it.id) ? 0 : Math.min(pay, it.coins - (h.funds[it.id] || 0));
      let balance = paid.balance;
      if (used < pay) {
        const back = await walletCall(this.env, body.walletId, "credit", { amount: pay - used, memo: `길드 홀 · ${it.name} 남은 코인` });
        if (back.ok) balance = back.balance;
      }
      let done = false;
      if (used > 0) {
        h.funds[it.id] = (h.funds[it.id] || 0) + used;
        h.donors[it.id] = h.donors[it.id] || {};
        const prev = h.donors[it.id][me.id] || { coins: 0 };
        h.donors[it.id][me.id] = { trainer: me.snap.trainer, coins: prev.coins + used };
        if (h.funds[it.id] >= it.coins) {
          h.owned.push(it.id);
          done = true;
          if (it.theme && !h.theme) h.theme = it.id; // 처음 다 모인 홀 배경은 바로 바른다
        }
        await this.store.put("hall", h);
      }
      return json({ ok: true, item: it.id, used, refunded: pay - used, done, balance, hall: this.publicHall(h) });
    }

    if (action === "listing") {
      if (meta.leader !== me.id) return fail("길드장만 목록 설정을 바꿀 수 있습니다", 403);
      const next = { ...meta, listed: Boolean(body.listed), intro: str(body.intro, 60) };
      await this.store.put("meta", next);
      if (next.listed) await this.publish(next, true);
      else await directoryCall(this.env, "remove", { code: meta.code });
      return json({ ok: true, listed: next.listed, intro: next.intro });
    }

    if (action === "hall/theme") {
      if (meta.leader !== me.id) return fail("길드장만 홀 배경을 바꿀 수 있습니다", 403);
      const h = await this.hall();
      const theme = str(body.theme, 24);
      if (theme !== "stone" && !(HALL_ITEMS.get(theme) || {}).theme) return fail("없는 홀 배경입니다");
      if (theme !== "stone" && !h.owned.includes(theme)) return fail("아직 모금이 다 되지 않은 배경입니다");
      h.theme = theme === "stone" ? null : theme;
      await this.store.put("hall", h);
      return json({ ok: true, hall: this.publicHall(h) });
    }

    if (action === "update") {
      const snap = cleanSnap(body.member);
      if (!snap) return fail("트레이너 이름이 없습니다");
      if (Date.now() - me.updated < UPDATE_GAP_MS) return fail("잠시 뒤에 다시 올려 주세요", 429);
      const wv = await walletOf(this.env, snap, body.walletKey);
      checkDeco(snap, wv);
      const wallet = (wv && (await this.bindable(snap, wv, me.id))) || me.wallet || null; // 확인된 지갑은 열쇠 없이 올려도 그대로
      await this.store.put("m:" + me.id, { ...me, snap, wallet, updated: Date.now() });
      await this.record(me.id, snap, me.joined);
      await this.publish(meta);
      return json({ ok: true, leader: meta.leader === me.id, walletOk: Boolean(wallet) && wallet === snap.walletId });
    }

    if (action === "leave") {
      await this.store.delete("m:" + me.id);
      await this.forget(me.id);
      await returnListingsOf(this, me.id); // 앱이 먼저 돌려받지만, 못 했으면 지갑 열쇠로 돌려받을 수 있게 둔다
      const rest = await this.members();
      // 마지막 사람이 나가면 길드도 없어진다 — 맡겨 둔 포켓몬이 남았으면 돌려받을 때까지 둔다
      if (!rest.length) {
        if (meta.listed) await directoryCall(this.env, "remove", { code: meta.code }); // 아무도 없는 길드는 목록에서 내린다
        if (!(await listings(this)).length) await this.store.deleteAll();
      } else {
        const next = meta.leader === me.id ? { ...meta, leader: rest[0].id } : meta; // 가장 오래된 길드원이 맡는다
        if (next !== meta) await this.store.put("meta", next);
        await this.publish(next, true);
      }
      return json({ ok: true });
    }

    if (action === "kick") {
      if (meta.leader !== me.id) return fail("길드장만 내보낼 수 있습니다", 403);
      const target = str(body.target, 40);
      if (!target || target === me.id) return fail("내보낼 길드원을 골라 주세요");
      await this.store.delete("m:" + target);
      await this.forget(target);
      await returnListingsOf(this, target); // 매물은 지갑 열쇠로 돌려받을 수 있게 둔다
      await this.publish(meta, true);
      return json({ ok: true });
    }

    if (action === "disband") {
      if (meta.leader !== me.id) return fail("길드장만 길드를 없앨 수 있습니다", 403);
      if ((await listings(this)).length) return fail("몰에 맡겨 둔 포켓몬이 있어 없앨 수 없습니다. 모두 돌려받은 뒤에 없애 주세요");
      if (meta.listed) await directoryCall(this.env, "remove", { code: meta.code });
      await this.store.deleteAll();
      return json({ ok: true });
    }

    return fail("모르는 요청입니다", 404);
  }
}

/** Worker 쪽 — 주소를 풀어 길드 객체에 넘긴다. 만들기는 여기서 코드를 정한다 */
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 0·O·1·I 는 뺐다
const newCode = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => ALPHA[b % ALPHA.length]).join("");

export async function guildRoute(request, env, code, action) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > 16_384) return fail("요청이 너무 큽니다", 413);
  const stub = (c) => env.GUILDS.get(env.GUILDS.idFromName(c));

  if (!code) {
    if (request.method !== "POST") return fail("POST 로 보내 주세요", 405);
    const body = await request.json().catch(() => null);
    if (!body) return fail("잘못된 요청입니다");
    for (let i = 0; i < 5; i++) {
      const c = newCode();
      const res = await stub(c).fetch("https://guild/create", { method: "POST", body: JSON.stringify({ ...body, code: c }) });
      if (res.status !== 409) return res;
    }
    return fail("코드를 만들지 못했습니다. 다시 시도해 주세요", 503);
  }
  if (request.method === "GET" && !action) return stub(code).fetch("https://guild/view");
  if (request.method === "GET" && action === "market") return stub(code).fetch("https://guild/market");
  if (request.method !== "POST" || !action) return fail("잘못된 요청입니다", 405);
  return stub(code).fetch("https://guild/" + action, { method: "POST", body: await request.text() });
}
