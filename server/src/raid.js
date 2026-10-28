/**
 * 길드 레이드 — 길드원이 함께 전설 보스를 쓰러뜨리고 그 전설의 조각을 모은다. 길드 객체(guild.js)가 부른다.
 *
 * 야생 전설은 만나기도(출현의 0.5%) 잡기도(5~25%) 어려워서, 원하는 전설 한 종은 사실상 얻을 수 없었다.
 * 레이드는 운 대신 함께 쌓는 길이다 — 같은 전설의 조각 SHARD_NEED 개면 그 전설을 받는다(wallet.js redeem).
 *
 * ── 보스 ──
 * 매주 월요일 0시(한국 시간)에 전설 · 환상 중 하나가 보스가 된다. 주 번호로 정해서 모든 길드가 같은
 * 보스와 싸운다(레이드 자체는 길드마다 따로다). 체력은 "칸"(BAR = 1:1 에서 한 번 쓰러뜨릴 만큼, 천분율)으로
 * 센다. 1단계는 길드원 수(최근 7일에 방을 올린 사람, 적어도 MIN_PEOPLE 명) × (길드원 수 + LINEUP - 1) × BARS_PER칸 —
 * 한 번 도전하면 길드원마다 한 마리씩(나는 쓰러지면 다음 아이로, LINEUP 마리까지) 함께 나와서, 한 판에 깎는
 * 양이 많으면 (길드원 수 + LINEUP - 1)마리분이기 때문이다(한 마리가 한 판에 평균 1~3칸). 쓰러뜨리면 더 센 다음 단계가 나온다(STAGE_MUL 배,
 * 3단계까지). 칸 수는 그 주에 레이드를 처음 볼 때 정해 두고 바꾸지 않는다.
 *
 * ── 도전 ──
 * 길드원마다 하루(한국 시간) TRIES 번 — 확인된 지갑으로 센다(나갔다 다시 들어와도 그대로). 도전을
 * 시작하면(start) 서버가 씨앗과 "이 단계의 남은 체력", 함께 싸울 길드원(party — 대표 팀 코드를 올린
 * 다른 길드원 모두)을 주고 한 번을 센다. 앱은 내 아이 한 마리와 길드원의 대표 포켓몬을 모두 내보내 그 씨앗으로
 * 결투를 끝까지 돌리고(src/main/raidbattle.js, Lv.50) 누구의 포켓몬이 얼마나 깎았는지 알린다(hit).
 * 깎은 칸은 그 포켓몬 주인의 기록이다 — 남의 포켓몬으로 내 기록을 쌓을 수 없고, 대표 포켓몬을 올려 둔
 * 길드원은 직접 도전하지 않아도 남의 도전에서 조금씩 쌓인다. 시작에서 세기 때문에 결과가 나쁘다고 다시
 * 돌릴 수 없다. 끝내지 않은 도전은 PEND_MS 동안 같은 씨앗 · 같은 길드원으로 다시 준다.
 *
 * 결투는 앱이 돌린다 — 서버는 깎은 양이 말이 되는지만 본다. 포켓몬 한 마리가 한 판(raidbattle.js RAID_TURNS 턴)에
 * 깎을 수 있는 건 PER_MON 칸까지(한 턴에 두 칸 남짓이 끝이다), 합쳐서 이 단계의 남은 체력까지 — 넘는 몫은
 * 잘라 낸다. 세이브가 그 사람 PC에 있어서 조작을 다 막을 수는 없다(고친 세이브로 한 사람이 레이드를 많이
 * 깎을 수는 있다). 그래도 하루 TRIES 번이고, 얻는 건 길드원 모두의 조각이라 남의 몫을 빼앗지는 못한다.
 *
 * ── 조각 ──
 * 한 단계를 쓰러뜨리면 그 단계에 조금이라도 깎은 길드원(내 포켓몬이 남의 도전에서 깎은 것도) 모두 보스의 조각 1개, 그 단계에서 가장 많이
 * 깎은 TOP_BONUS 명은 1개 더. 조각은 "확인된 지갑"(m.wallet)에 넣는다 — 세이브에 두면 고쳐서 만들 수
 * 있다. 지갑은 한 주에 한 길드의 레이드 조각만 받는다(wallet.js shard, 409). 지갑이 아직 확인되지 않은
 * 사람의 조각은 PENDING_DAYS 동안 기다린다.
 *
 *   POST /guild/ABCD2345/raid/start   { memberId, key }        → { seed, start, line, stage, triesLeft, party: [{ id, trainer, team }] }
 *   POST /guild/ABCD2345/raid/hit     { memberId, key, credit: { 길드원 번호: 천분율 } } → { dealt, cleared, raid }
 *   GET  /guild/ABCD2345 의 raid                                 → raidView
 */
import LINES from "../../src/main/lines.json" with { type: "json" };
import { walletCall } from "./wallet.js";

export const TRIES = 3;
export const BAR = 1000;
const MIN_PEOPLE = 3;
export const STAGE_MUL = [1, 1.5, 2];
export const LINEUP = 6; // 한 도전에 내보낼 수 있는 내 아이 — 한 번에 한 마리, 쓰러지면 다음 아이로
const BARS_PER = 2;
const PER_MON = 20; // 한 판에 포켓몬 한 마리가 깎을 수 있는 칸 — 10턴 × 한 턴에 두 칸
const SHARD_MIN = 1; // 그 단계에 조금이라도 깎아야 조각을 받는다
const TOP_BONUS = 3;
const PEND_MS = 10 * 60_000;
const PENDING_DAYS = 14;
const KEEP_RAIDS = 4; // 조각을 아직 못 넣은 지난 레이드를 이만큼 둔다
const DAY_MS = 86_400_000;
const KST = 9 * 3_600_000;

/** 보스가 될 수 있는 라인 — 전설 · 환상 */
export const BOSSES = LINES.map((l, i) => (l.single && l.legendary ? i : -1)).filter((i) => i >= 0);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const fail = (reason, status = 400) => json({ ok: false, reason }, status);

/** 한국 시간의 날짜 · 그 주 월요일 */
export const raidDay = (t) => new Date(t + KST).toISOString().slice(0, 10);
export function raidWeek(t) {
  const d = new Date(t + KST);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS).toISOString().slice(0, 10);
}
/** 그 주의 보스 — 주 번호에 29를 곱해 돌린다(보스 수와 서로소면 모든 전설이 한 번씩 나온다) */
export function bossOf(week) {
  const n = Math.round(Date.parse(week + "T00:00:00Z") / (7 * DAY_MS));
  return BOSSES[(((n * 29) % BOSSES.length) + BOSSES.length) % BOSSES.length];
}
const barsOf = (people, stage) => Math.round(BARS_PER * people * (people + LINEUP - 1) * STAGE_MUL[stage - 1]) * BAR;

/** 이번 주 레이드 — 처음 볼 때 만든다 */
async function current(g) {
  const now = Date.now();
  const week = raidWeek(now);
  let st = await g.store.get("raid:" + week);
  if (st) return st;
  const people = Math.max(MIN_PEOPLE, (await g.members()).filter((m) => now - m.updated < 7 * DAY_MS).length);
  st = { week, line: bossOf(week), people, stage: 1, max: barsOf(people, 1), hp: barsOf(people, 1), done: false, rows: {}, pend: {}, cleared: [], rewards: [] };
  await g.store.put("raid:" + week, st);
  const keys = [...(await g.store.list({ prefix: "raid:" })).keys()].sort();
  if (keys.length > KEEP_RAIDS) await g.store.delete(keys.slice(0, keys.length - KEEP_RAIDS));
  return st;
}

/** 함께 싸울 길드원 — 대표 팀 코드를 올린 다른 길드원 모두, 들어온 순서로 */
async function partyOf(g, meId, ids = null) {
  const list = (await g.members()).filter((m) => m.id !== meId && m.snap && m.snap.team).sort((a, b) => a.joined - b.joined || (a.id < b.id ? -1 : 1));
  const pick = ids ? ids.map((id) => list.find((m) => m.id === id)).filter(Boolean) : list;
  return pick.map((m) => ({ id: m.id, trainer: m.snap.trainer, team: m.snap.team }));
}

/** 화면에 보일 레이드 */
function publicRaid(st, now = Date.now()) {
  const day = raidDay(now);
  return {
    week: st.week, line: st.line, stage: st.stage, stages: STAGE_MUL.length, hp: st.hp, max: st.max, bar: BAR,
    done: st.done, tries: TRIES, day, cleared: st.cleared,
    rows: Object.entries(st.rows).map(([id, r]) => {
      const t = (st.tries || {})[r.k];
      return { id, trainer: r.trainer, d: r.d, h: r.h || 0, sd: (r.s || {})[st.stage] || 0, n: t && t.day === day ? t.n : 0 };
    })
      .sort((a, b) => b.d - a.d),
    rewards: st.rewards.filter((x) => x.done && !x.skipped).map(({ id, n, stage }) => ({ id, n, stage })),
    shardMin: SHARD_MIN, topBonus: TOP_BONUS, lineup: LINEUP,
  };
}

/** 쓰러뜨린 단계의 조각 — 그 단계에 SHARD_MIN 이상 깎은 사람 모두 1, 많이 깎은 TOP_BONUS 명은 1 더 */
function stageRewards(st, stage) {
  const rows = Object.entries(st.rows).map(([id, r]) => ({ id, d: (r.s || {})[stage] || 0 })).filter((r) => r.d >= SHARD_MIN).sort((a, b) => b.d - a.d);
  return rows.map((r, i) => ({ id: r.id, n: i < TOP_BONUS ? 2 : 1, stage, done: false }));
}

/** 못 넣은 조각을 넣는다. 지갑에 넣다 실패한 건 다음에 다시 */
export async function payRaids(g) {
  const members = new Map((await g.members()).map((m) => [m.id, m]));
  const code = ((await g.store.get("meta")) || {}).code;
  for (const [key, st] of await g.store.list({ prefix: "raid:" })) {
    const marks = new Map(); // 보상 순번 → { skipped }
    for (const [i, rw] of st.rewards.entries()) {
      if (rw.done) continue;
      const m = members.get(rw.id);
      const late = Date.now() > Date.parse(st.week + "T00:00:00Z") + (7 + PENDING_DAYS) * DAY_MS;
      if (!m || (!m.wallet && late)) { marks.set(i, true); continue; } // 나갔거나 끝내 지갑을 확인하지 못했다
      if (!m.wallet) continue;
      // rid — 같은 보상을 두 번 넣지 않게(두 요청이 겹쳐 둘 다 넣으려 해도 지갑이 한 번만 받는다)
      const r = await walletCall(g.env, m.wallet, "shard", { line: st.line, n: rw.n, guild: code, week: st.week, rid: `${st.week}:${rw.stage}:${rw.id}` });
      if (r.ok || r.status === 404) marks.set(i, false);
      else if (r.status === 409) marks.set(i, true); // 그 주 조각을 이미 다른 길드에서 받은 지갑
    }
    if (!marks.size) continue;
    // 지갑을 부르는 사이 다른 길드원이 깎았을 수 있다 — 다시 읽어 표시만 더한다
    const fresh = await g.store.get(key);
    if (!fresh) continue;
    for (const [i, skipped] of marks) if (fresh.rewards[i]) Object.assign(fresh.rewards[i], skipped ? { done: true, skipped: true } : { done: true });
    await g.store.put(key, fresh);
  }
}

export async function raidView(g) {
  await payRaids(g).catch(() => {});
  return publicRaid(await current(g));
}

export async function raidAction(g, action, me, body) {
  const now = Date.now();
  const st = await current(g);
  const day = raidDay(now);
  const row = st.rows[me.id] || (st.rows[me.id] = { trainer: me.snap.trainer, d: 0, s: {} });
  row.trainer = me.snap.trainer;
  // 하루 몇 번은 확인된 지갑으로 센다 — 길드를 나갔다 다시 들어오면 길드원 번호가 바뀌어 새로 세어지지 않게
  row.k = me.wallet ? "w:" + me.wallet : "m:" + me.id;
  st.tries = st.tries || {};
  const t = st.tries[row.k] && st.tries[row.k].day === day ? st.tries[row.k] : (st.tries[row.k] = { day, n: 0 });

  if (action === "start") {
    if (st.done) return fail("이번 주 레이드는 끝났습니다. 다음 주 월요일에 새 보스가 나옵니다", 409);
    const p = st.pend[me.id];
    if (p && now - p.at < PEND_MS) {
      return json({ ok: true, seed: p.seed, start: p.start, line: st.line, stage: p.stage, triesLeft: TRIES - t.n, party: await partyOf(g, me.id, p.party || []), again: true });
    }
    if (t.n >= TRIES) return fail(`오늘 도전은 다 했습니다(하루 ${TRIES}번). 내일(한국 시간 0시) 다시 도전할 수 있습니다`, 429);
    t.n++;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const party = await partyOf(g, me.id);
    st.pend[me.id] = { seed, start: st.hp, stage: st.stage, at: now, party: party.map((x) => x.id) };
    await g.store.put("raid:" + st.week, st);
    return json({ ok: true, seed, start: st.hp, line: st.line, stage: st.stage, triesLeft: TRIES - t.n, party });
  }

  if (action === "hit") {
    const p = st.pend[me.id];
    if (!p) return fail("시작한 도전이 없습니다");
    // credit — 길드원 번호마다 그 사람 포켓몬이 깎은 양. 나는 내보낸 아이 LINEUP 마리만큼, 다른 길드원은 대표 한 마리만큼까지
    const credit = body.credit && typeof body.credit === "object" ? body.credit : {};
    const party = new Set(p.party || []);
    const want = [];
    for (const [id, v] of Object.entries(credit)) {
      if ((id !== me.id && !party.has(id)) || !Number.isInteger(v) || v < 0) return fail("깎은 체력이 맞지 않습니다");
      const cap = (id === me.id ? LINEUP : 1) * PER_MON * BAR;
      if (v > 0) want.push([id, Math.min(v, cap)]);
    }
    delete st.pend[me.id];
    // 합쳐서 시작할 때 남은 체력보다 많이 깎을 수 없다. 그 사이 다른 길드원이 깎았으면 남은 만큼만 —
    // 넘치면 저마다 같은 비율로 줄인다(그 사이 단계가 넘어갔으면 새 단계에 넣는다 — 함께 깎던 한 판이 날아가지 않게)
    const sum = want.reduce((a, [, v]) => a + v, 0);
    const room = st.done ? 0 : Math.min(p.start, st.hp);
    const k = sum > room ? room / sum : 1;
    let dealt = 0;
    const members = new Map((await g.members()).map((m) => [m.id, m]));
    for (const [i, [id, v]] of want.entries()) {
      // 마지막 몫은 남은 만큼 — 줄였을 때 한 점이 남아 보스가 안 쓰러지지 않게
      const n = k === 1 ? v : i === want.length - 1 ? Math.min(v, room - dealt) : Math.floor(v * k);
      if (n <= 0) continue;
      const m = id === me.id ? me : members.get(id);
      const r = st.rows[id] || (st.rows[id] = { trainer: m ? m.snap.trainer : "", d: 0, s: {} });
      if (m) r.trainer = m.snap.trainer;
      r.d += n;
      if (id !== me.id) r.h = (r.h || 0) + n; // 남의 도전에서 도운 몫
      r.s[st.stage] = (r.s[st.stage] || 0) + n;
      dealt += n;
    }
    let cleared = 0;
    if (dealt > 0) {
      st.hp -= dealt;
      if (st.hp <= 0) {
        cleared = st.stage;
        st.cleared.push({ stage: st.stage, at: now, by: me.snap.trainer });
        st.rewards.push(...stageRewards(st, st.stage));
        if (st.stage < STAGE_MUL.length) {
          st.stage++;
          st.max = st.hp = barsOf(st.people, st.stage);
        } else {
          st.done = true;
        }
      }
    }
    await g.store.put("raid:" + st.week, st);
    if (cleared) await payRaids(g).catch(() => {});
    return json({ ok: true, dealt, cleared, raid: publicRaid((await g.store.get("raid:" + st.week)) || st, now) });
  }

  return fail("모르는 요청입니다", 404);
}
