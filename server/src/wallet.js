/**
 * 코인 지갑 — 몰에서 쓰는 화폐(🪙). 지갑 번호 하나에 Durable Object 하나.
 *
 * 사탕은 각자 PC 세이브에 있어서 고치면 그만이다. 코인은 처음부터 서버가 잔액을 들고 있다 —
 * 가짜로 결제하거나 같은 코인을 두 번 쓸 수 없다. 그래서 코인은 서버가 확인할 수 있는
 * 일로만 생긴다:
 *
 *   출석           CHECKIN        하루 한 번 (그 사람 PC 의 날짜, 서버 시각 ±36시간 안)
 *   사탕 환전      EXCHANGE_RATE  🍬1 → 🪙5, 하루 EXCHANGE_MAX 번까지. 사탕은 서버가 확인할 수
 *                                 없어서(세이브에 있다) 하루 한도로 묶는다
 *   상점에 팔기    shopPrice      인기 없는 아이를 상점이 사 준다(박스 정리). 값은 서버가 센다.
 *                                 포켓몬도 세이브에 있어서 가짜를 팔 수 있다 — 하루 SELL_MAX 마리,
 *                                 🪙SELL_COINS 까지로 묶는다. 값을 낮게 둔 것도 그래서다 — 좋은 아이는
 *                                 몰에서 사람에게 파는 게 이득이어야 몰이 돈다
 *   몰 판매 대금 · 길드 주간 보상  — 길드 객체가 credit 으로 넣는다(아래)
 *
 * ── 코인 → 사탕 (candy) ──
 * 사탕 환전의 반대. 🪙CANDY_COINS 에 🍬1, 하루 CANDY_MAX 개까지. 사탕 → 코인(🍬1 → 🪙5)보다
 * 훨씬 비싸서 오가며 불릴 수 없다. 사탕은 앱이 세이브에 더한다 — 서버는 코인만 뺀다.
 *
 * ── 코인 꾸미기 (buy) ──
 * 코인이 빠져나가는 곳. 코인으로만 사는 배경·가구(src/main/deco.json — 앱과 같은 파일)를 산다.
 * 값은 서버가 카탈로그에서 정하고, 산 것은 지갑에 적어 둔다(deco). 사탕 가구는 세이브에만
 * 있어서 고치면 생기지만, 코인 꾸미기는 길드 객체가 지갑의 산 목록과 맞춰 보고 안 산 것은
 * 길드 방에서 지운다(guild.js). 되팔기 · 선물은 없다 — 쓴 코인은 그대로 사라진다.
 *
 * ── 계정 없이 ──
 * 만들 때 지갑 번호와 열쇠를 한 번 준다. 서버에는 열쇠의 해시만 둔다. 열쇠를 잃으면 지갑도
 * 잃는다(앱은 세이브에 두고, 세이브 백업에 같이 들어간다).
 *
 * ── 부계정으로 코인 모으기 막기 ──
 * 계정이 없으니 지갑은 몇 개든 만들 수 있다. 지갑마다 코인이 생기고 그걸 몰에서 한 지갑으로
 * 몰아줄 수 있으면 경제가 무너진다. 그래서
 *   - 처음 지원금이 없다. 지갑을 만드는 것만으로는 코인이 생기지 않는다
 *   - 같은 인터넷 주소(IP)에서는 하루 GATE_PER_DAY 개까지만 만든다. 같은 사무실 동료가 같은
 *     주소를 쓸 수 있어 넉넉히 잡았다. 주소는 저장하지 않고 해시로만 센다(gate)
 *   - 새 지갑은 BUY_WAIT_MS 가 지나야 몰에서 살 수 있다(market.js). 파는 건 바로 된다
 * 완전히 막을 수는 없다 — 몰이 길드 안에서만 돌아서, 길드장이 낯선 길드원을 내보낼 수 있다.
 *
 * ── 길드 주간 보상은 주마다 길드 하나에서만 ──
 * 서버는 같은 사람인지 모른다(계정이 없다). 세이브를 하나 더 쓰거나 서버를 직접 부르면 같은 지갑으로
 * 여러 길드에 들어가 길드마다 주간 보상(1위 · 칭호 · 공동 목표)을 받을 수 있었다. 그래서 지갑이
 * 주마다 "그 주 보상을 준 길드"를 적어 두고(guildWeeks), 같은 주 보상을 다른 길드가 넣으려 하면
 * 409 로 거절한다. 같은 길드는 그 주에 여러 번(1위 + 칭호 + 목표) 넣을 수 있다.
 * 묶을 때가 아니라 넣을 때 본다 — 묶을 때만 보면, 길드 A 에 묶고 보상을 받은 뒤 B 로 옮겨 또 받는다.
 * 앱을 그대로 쓰는 사람은 한 번에 한 길드라 걸리지 않는다(길드를 나가면 그 길드의 내 기록도 지워진다).
 *
 * ── 주소 (walletRoute) ──
 *   POST /wallet                          만들기            → { walletId, key, balance }
 *   POST /wallet/w0123456789ab            보기   { key }    → { balance, checkin, exLeft, log }
 *   POST /wallet/w0123456789ab/checkin    출석   { key, day }
 *   POST /wallet/w0123456789ab/exchange   환전   { key, day, n }
 *   POST /wallet/w0123456789ab/sell       상점에 팔기 { key, day, mon: { line, grown, shiny } }
 *   POST /wallet/w0123456789ab/buy        코인 꾸미기 사기 { key, item }  → { ...보기, item }
 *   POST /wallet/w0123456789ab/candy      코인 → 사탕 { key, day, n }    → { ...보기, got, paid }
 *
 * debit · credit 은 밖에서 부를 수 없다 — walletRoute 가 넘기지 않고, 길드 객체(몰·주간 보상)만
 * 지갑 객체를 직접 부른다. debit 은 그래도 열쇠를 본다(사는 사람이 열쇠를 넘겨야 빠진다).
 */

import LINES from "../../src/main/lines.json" with { type: "json" };
import DECO from "../../src/main/deco.json" with { type: "json" };

/** 코인 꾸미기 카탈로그 — id → { name, coins } (배경·가구 id 는 겹치지 않는다) */
export const DECO_ITEMS = new Map([...DECO.themes, ...DECO.furni].map((d) => [d.id, d]));
export const DECO_THEMES = new Set(DECO.themes.map((d) => d.id));

export const GATE_PER_DAY = 5;
export const BUY_WAIT_MS = 2 * 86_400_000;
const GATE_SALT = "poketokenbar-wallet-gate"; // 주소를 그대로 두지 않으려는 것 — 비밀은 아니다
export const SELL_MAX = 10;
export const SELL_COINS = 100;
// 앱 pokemon.js 의 STAGES · RARITY 와 같아야 한다(값이 같게 보인다)
const STAGE_AT = [0, 5_000_000, 80_000_000, 400_000_000, 1_500_000_000];
const STAGE_MUL = [0, 1, 1.5, 2, 3];
const STAR_COINS = [[30, 8], [45, 5], [90, 3], [150, 2], [Infinity, 1]]; // 포획률 이하 → 코인

/** 상점이 사 주는 값 — 희귀도 × 진화 단계 × 이로치. 전설은 기본 15 */
export function shopPrice(mon) {
  const L = LINES[mon.line];
  if (!L || !Number.isFinite(mon.grown) || mon.grown < STAGE_AT[1]) return 0; // 알은 안 산다
  let st = 0;
  for (let i = 0; i < STAGE_AT.length; i++) if (mon.grown >= STAGE_AT[i]) st = i;
  const base = L.single && L.legendary ? 15 : STAR_COINS.find(([max]) => (L.captureRate ?? 45) <= max)[1];
  return Math.max(1, Math.round(base * STAGE_MUL[st] * (mon.shiny ? 3 : 1)));
}
export const CHECKIN = 10;
export const EXCHANGE_RATE = 5;
export const EXCHANGE_MAX = 5;
export const CANDY_COINS = 20; // 코인 → 사탕 — 사탕 하나 값
export const CANDY_MAX = 5; // 하루 사탕 몇 개까지
const LOG_KEEP = 30;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const fail = (reason, status = 400) => json({ ok: false, reason }, status);

async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

export const WALLET_ID = /^w[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** 그 사람 PC 의 날짜가 말이 되나 — 서버 시각에서 ±36시간(시간대 차이) 안 */
const sane = (day) => DAY.test(day) && Math.abs(Date.parse(day + "T12:00:00Z") - Date.now()) < 36 * 3_600_000;
const memo = (s) => String(s ?? "").replace(/[\u0000-\u001f]/g, "").slice(0, 40);
const GUILD_WEEKS_KEEP = 26; // 주간 보상을 준 길드를 기억하는 주 — 길드의 주간 기록과 같다

export class Wallet {
  constructor(state) {
    this.store = state.storage;
  }

  view(w) {
    return {
      ok: true,
      balance: w.balance,
      created: w.created,
      canBuyAt: w.created + BUY_WAIT_MS, // 새 지갑은 이때부터 몰에서 살 수 있다
      checkin: w.checkin || "",
      exDay: w.ex.day,
      exLeft: EXCHANGE_MAX - w.ex.n,
      sellDay: (w.sell || {}).day || "",
      sellLeft: SELL_MAX - ((w.sell || {}).n || 0),
      sellCoinsLeft: SELL_COINS - ((w.sell || {}).coins || 0),
      deco: w.deco || [], // 산 코인 꾸미기
      cbDay: (w.cb || {}).day || "",
      cbLeft: CANDY_MAX - ((w.cb || {}).n || 0), // 코인 → 사탕 오늘 남은 개수
      candyCoins: CANDY_COINS,
      log: w.log.slice(-LOG_KEEP).reverse(),
    };
  }

  async save(w, delta, why) {
    w.log.push({ at: Date.now(), d: delta, memo: memo(why), bal: w.balance });
    if (w.log.length > LOG_KEEP * 2) w.log = w.log.slice(-LOG_KEEP);
    await this.store.put("w", w);
  }

  async fetch(request) {
    const action = new URL(request.url).pathname.slice(1);
    let body;
    try {
      body = await request.json();
    } catch {
      return fail("잘못된 요청입니다");
    }
    if (action === "gate") {
      const n = (await this.store.get("n")) || 0;
      if (n >= GATE_PER_DAY) return fail(`이 인터넷 주소에서는 오늘 지갑을 ${GATE_PER_DAY}개까지 만들 수 있습니다. 내일 다시 시도해 주세요`, 429);
      await this.store.put("n", n + 1);
      return json({ ok: true, n: n + 1 });
    }

    let w = await this.store.get("w");

    if (action === "create") {
      if (w) return fail("이미 있는 지갑", 409);
      const key = randomHex(16);
      w = { id: body.id, keyHash: await sha256(key), balance: 0, created: Date.now(), checkin: "", ex: { day: "", n: 0 }, log: [] };
      await this.save(w, 0, "지갑 만듦");
      return json({ ok: true, walletId: body.id, key, balance: w.balance, created: w.created });
    }
    if (!w) return fail("없는 지갑입니다", 404);

    // 길드 객체만 부른다 — 판매 대금 · 주간 보상. 주간 보상은 guild · week 를 같이 보낸다
    if (action === "credit") {
      const n = Number(body.amount);
      if (!Number.isSafeInteger(n) || n <= 0 || n > 1_000_000) return fail("금액이 맞지 않습니다");
      if (body.guild && body.week) {
        const guild = String(body.guild).slice(0, 8);
        const week = String(body.week).slice(0, 10);
        w.guildWeeks = w.guildWeeks || {};
        const paidBy = w.guildWeeks[week];
        if (paidBy && paidBy !== guild) return fail("이 지갑은 그 주 길드 보상을 이미 다른 길드에서 받았습니다", 409);
        w.guildWeeks[week] = guild;
        const weeks = Object.keys(w.guildWeeks).sort();
        for (const k of weeks.slice(0, Math.max(0, weeks.length - GUILD_WEEKS_KEEP))) delete w.guildWeeks[k];
      }
      w.balance += n;
      await this.save(w, n, body.memo);
      return json({ ok: true, balance: w.balance });
    }

    if (typeof body.key !== "string" || w.keyHash !== (await sha256(body.key))) return fail("지갑 열쇠가 맞지 않습니다", 403);

    if (action === "view") return json(this.view(w));

    if (action === "checkin") {
      if (!sane(body.day)) return fail("날짜가 맞지 않습니다. PC 시계를 확인해 주세요");
      if (w.checkin === body.day) return fail("오늘 출석 코인은 이미 받았습니다");
      if (w.checkin && body.day < w.checkin) return fail("날짜가 맞지 않습니다");
      w.checkin = body.day;
      w.balance += CHECKIN;
      await this.save(w, CHECKIN, "출석");
      return json({ ...this.view(w), got: CHECKIN });
    }

    if (action === "exchange") {
      const n = Number(body.n);
      if (!sane(body.day)) return fail("날짜가 맞지 않습니다. PC 시계를 확인해 주세요");
      if (!Number.isInteger(n) || n < 1 || n > EXCHANGE_MAX) return fail("환전은 한 번에 사탕 1~5개입니다");
      if (w.ex.day !== body.day) w.ex = { day: body.day, n: 0 };
      if (w.ex.n + n > EXCHANGE_MAX) return fail(`오늘 환전 한도(사탕 ${EXCHANGE_MAX}개)를 넘습니다. 남은 한도 ${EXCHANGE_MAX - w.ex.n}개`);
      w.ex.n += n;
      w.balance += n * EXCHANGE_RATE;
      await this.save(w, n * EXCHANGE_RATE, `사탕 ${n}개 환전`);
      return json({ ...this.view(w), got: n * EXCHANGE_RATE });
    }

    if (action === "candy") {
      const n = Number(body.n);
      if (!sane(body.day)) return fail("날짜가 맞지 않습니다. PC 시계를 확인해 주세요");
      if (!Number.isInteger(n) || n < 1 || n > CANDY_MAX) return fail(`사탕은 한 번에 1~${CANDY_MAX}개까지 삽니다`);
      if (!w.cb || w.cb.day !== body.day) w.cb = { day: body.day, n: 0 };
      if (w.cb.n + n > CANDY_MAX) return fail(`오늘 코인으로 살 수 있는 사탕(${CANDY_MAX}개)을 넘습니다. 남은 한도 ${CANDY_MAX - w.cb.n}개`);
      const paid = n * CANDY_COINS;
      if (w.balance < paid) return fail(`코인이 모자랍니다 (🪙${w.balance} / 🪙${paid})`, 402);
      w.cb.n += n;
      w.balance -= paid;
      await this.save(w, -paid, `사탕 ${n}개 사기`);
      return json({ ...this.view(w), got: n, paid });
    }

    if (action === "sell") {
      if (!sane(body.day)) return fail("날짜가 맞지 않습니다. PC 시계를 확인해 주세요");
      const mon = body.mon || {};
      const price = shopPrice({ line: Number(mon.line), grown: Number(mon.grown), shiny: Boolean(mon.shiny) });
      if (!price) return fail("상점에서 사지 않는 포켓몬입니다");
      if (!w.sell || w.sell.day !== body.day) w.sell = { day: body.day, n: 0, coins: 0 };
      if (w.sell.n >= SELL_MAX) return fail(`오늘은 상점에 ${SELL_MAX}마리까지 팔 수 있습니다`);
      const got = Math.min(price, SELL_COINS - w.sell.coins);
      if (got <= 0) return fail(`오늘 상점에서 받을 수 있는 코인(🪙${SELL_COINS})을 다 받았습니다`);
      w.sell.n += 1;
      w.sell.coins += got;
      w.balance += got;
      await this.save(w, got, "상점에 팔기");
      return json({ ...this.view(w), got, price });
    }

    if (action === "buy") {
      const it = DECO_ITEMS.get(String(body.item || ""));
      if (!it) return fail("없는 물건입니다");
      w.deco = w.deco || [];
      if (w.deco.includes(it.id)) return fail("이미 가지고 있습니다", 409);
      if (w.balance < it.coins) return fail(`코인이 모자랍니다 (🪙${w.balance} / 🪙${it.coins})`, 402);
      w.balance -= it.coins;
      w.deco.push(it.id);
      await this.save(w, -it.coins, `꾸미기 · ${it.name}`);
      return json({ ...this.view(w), item: it.id });
    }

    // 길드 객체만 부른다 — 몰에서 살 때. 사는 사람의 열쇠는 위에서 이미 봤다
    if (action === "debit") {
      const n = Number(body.amount);
      if (!Number.isSafeInteger(n) || n <= 0) return fail("금액이 맞지 않습니다");
      if (w.balance < n) return fail(`코인이 모자랍니다 (🪙${w.balance})`, 402);
      w.balance -= n;
      await this.save(w, -n, body.memo);
      return json({ ok: true, balance: w.balance });
    }

    return fail("모르는 요청입니다", 404);
  }
}

/** 지갑 객체 — 길드 객체가 판매 대금 · 주간 보상을 넣고, 몰에서 살 때 뺀다 */
export const walletStub = (env, id) => env.WALLETS.get(env.WALLETS.idFromName(id));
export async function walletCall(env, id, action, body) {
  const res = await walletStub(env, id).fetch("https://wallet/" + action, { method: "POST", body: JSON.stringify(body) });
  return { status: res.status, ...(await res.json().catch(() => ({ ok: false, reason: "지갑 응답을 읽지 못했습니다" }))) };
}

/** Worker 쪽 — 밖에서 부를 수 있는 건 만들기 · 보기 · 출석 · 환전 · 상점에 팔기 · 꾸미기 사기 · 사탕 사기뿐이다 */
export async function walletRoute(request, env, id, action) {
  if (request.method !== "POST") return fail("POST 로 보내 주세요", 405);
  const len = Number(request.headers.get("content-length") || 0);
  if (len > 4096) return fail("요청이 너무 큽니다", 413);
  if (!id) {
    // 같은 주소에서 하루 몇 개까지 — 주소는 해시로만 센다
    const ip = request.headers.get("CF-Connecting-IP") || "local";
    const day = new Date().toISOString().slice(0, 10);
    const tag = (await sha256(GATE_SALT + ip)).slice(0, 24);
    const gate = await walletStub(env, `gate:${day}:${tag}`).fetch("https://wallet/gate", { method: "POST", body: "{}" });
    if (gate.status !== 200) return gate;
    for (let i = 0; i < 5; i++) {
      const wid = "w" + randomHex(6);
      const res = await walletStub(env, wid).fetch("https://wallet/create", { method: "POST", body: JSON.stringify({ id: wid }) });
      if (res.status !== 409) return res;
    }
    return fail("지갑을 만들지 못했습니다. 다시 시도해 주세요", 503);
  }
  if (!["checkin", "exchange", "sell", "buy", "candy"].includes(action || "") && action) return fail("모르는 요청입니다", 404);
  return walletStub(env, id).fetch("https://wallet/" + (action || "view"), { method: "POST", body: await request.text() });
}
