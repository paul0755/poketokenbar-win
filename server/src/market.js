/**
 * 길드 몰 — 길드원끼리 포켓몬을 코인(🪙)으로 사고판다. 길드 객체(guild.js) 안에서 돈다.
 *
 * ── 맡김 (에스크로) ──
 * 판매 등록을 하면 앱은 그 아이를 박스에서 빼고, 서버가 아이를 맡는다("ls:<id>"). 같은 아이를
 * 두 번 팔거나 팔고도 갖고 있는 일을 막으려는 것이다. 팔리면 산 사람에게 넘어가고, 취소·
 * 기한(LIST_DAYS) 만료·내보내기면 판 사람이 돌려받는다(cancel).
 *
 * ── 코인 ──
 * 사면 산 사람 지갑에서 빠지고(열쇠 확인), 판 사람 지갑으로 판매가에서 수수료(FEE)를 뺀 만큼
 * 들어간다. 수수료는 사라진다 — 코인이 돌기만 하면 값이 계속 오른다. 판 사람이 꺼져 있어도 된다.
 *
 * 같은 아이를 두 사람이 동시에 사지 못하게 사는 동안 "buying" 으로 막아 둔다 — 지갑 객체를
 * 부르는 동안 다른 요청이 끼어들 수 있다.
 *
 * 포켓몬 데이터는 꼴만 본다. 말이 되는 값인지(그 종이 배울 수 있는 기술인지 등)는 앱이 사기
 * 전에 다시 본다 — 종·기술 사전은 앱에 있다.
 *
 * ── 주소 (guild.js 가 넘겨준다) ──
 *   GET  /guild/ABCD2345/market            매물 · 최근 거래
 *   POST /guild/ABCD2345/market/list       팔기 { memberId, key, walletId, walletKey, mon, price }
 *   POST /guild/ABCD2345/market/buy        사기 { memberId, key, walletId, walletKey, listingId }
 *   POST /guild/ABCD2345/market/cancel     돌려받기 { walletId, walletKey, listingId } — 취소·만료·내보내짐
 */
import { WALLET_ID, walletCall } from "./wallet.js";

export const LIST_MAX = 5; // 한 사람이 동시에 올려 둘 수 있는 수
export const LIST_DAYS = 7;
export const PRICE_MAX = 9999;
export const FEE = 0.05;
const SALES_KEEP = 100;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const fail = (reason, status = 400) => json({ ok: false, reason }, status);
const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const str = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, n);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const GENDERS = ["무성", "수컷", "암컷"];

/** 판매할 아이 — 교환 코드와 같은 내용. 꼴만 본다 */
function cleanMon(m) {
  if (!m || typeof m !== "object") return null;
  const ok =
    isInt(m.line, 0, 2000) && isInt(m.nature, 0, 24) && isInt(m.ability, 0, 3) &&
    Array.isArray(m.ivs) && m.ivs.length === 6 && m.ivs.every((v) => isInt(v, 0, 31)) &&
    GENDERS.includes(m.gender) &&
    Array.isArray(m.eggMoves) && m.eggMoves.length <= 2 && m.eggMoves.every((v) => isInt(v, 1, 2000)) &&
    Array.isArray(m.tmMoves) && m.tmMoves.length <= 100 && m.tmMoves.every((v) => isInt(v, 1, 2000)) &&
    Number.isFinite(m.grown) && m.grown >= 0 && m.grown <= 5e9;
  if (!ok) return null;
  return {
    line: m.line, nature: m.nature, shiny: Boolean(m.shiny), ivs: m.ivs, gender: m.gender, ability: m.ability,
    eggMoves: m.eggMoves, tmMoves: m.tmMoves, grown: Math.round(m.grown),
    lvGrown: Number.isFinite(m.lvGrown) && m.lvGrown > m.grown && m.lvGrown <= 5e9 ? Math.round(m.lvGrown) : null,
    hold: m.hold === true, ot: str(m.ot, 16), caughtAt: /^\d{4}-\d{2}-\d{2}$/.test(m.caughtAt) ? m.caughtAt : null,
  };
}

const feeOf = (price) => Math.floor(price * FEE);

/** 지갑 열쇠가 맞나 — 지갑 객체에 물어본다 */
async function walletOk(env, id, key) {
  if (!WALLET_ID.test(id || "") || typeof key !== "string") return false;
  const r = await walletCall(env, id, "view", { key });
  return Boolean(r.ok);
}

export async function listings(g) {
  return [...(await g.store.list({ prefix: "ls:" })).values()].sort((a, b) => b.at - a.at);
}

/** GET — 매물(팔린 건 빠진다)과 최근 거래. 지갑 번호는 비밀이 아니다(열쇠가 있어야 쓴다) */
export async function marketView(g) {
  await payPending(g);
  const now = Date.now();
  const list = (await listings(g)).map((l) => ({ ...l, expired: l.state === "open" && now > l.expires }));
  return json({ ok: true, listings: list, sales: (await g.store.get("sales")) || [], fee: FEE, max: LIST_MAX, now });
}

/** 판매 대금을 넣다가 실패한 것 — 다음 몰 요청 때 다시 넣는다 */
async function payPending(g) {
  for (const [key, p] of await g.store.list({ prefix: "pay:" })) {
    const r = await walletCall(g.env, p.wallet, "credit", { amount: p.amount, memo: p.memo });
    if (r.ok || r.status === 404) await g.store.delete(key);
  }
}

/** 내보내지면 그 사람의 매물은 돌려받을 수 있게 둔다(지갑 열쇠로 cancel) */
export async function returnListingsOf(g, memberId) {
  for (const [key, l] of await g.store.list({ prefix: "ls:" })) {
    if (l.seller === memberId && l.state === "open") await g.store.put(key, { ...l, state: "returned" });
  }
}

export async function marketAction(g, action, body, meta) {
  await payPending(g);

  if (action === "cancel") {
    const l = await g.store.get("ls:" + str(body.listingId, 20));
    if (!l) return fail("없는 매물입니다. 이미 팔렸거나 돌려받았습니다", 404);
    if (l.wallet !== body.walletId || !(await walletOk(g.env, body.walletId, body.walletKey))) return fail("내 매물이 아닙니다", 403);
    if (l.state === "buying") return fail("지금 누가 사는 중입니다. 잠시 뒤에 다시 시도해 주세요", 409);
    await g.store.delete("ls:" + l.id);
    return json({ ok: true, mon: l.mon });
  }

  const me = await g.who(body);
  if (!me) return fail("길드원 열쇠가 맞지 않습니다. 이미 나갔거나 내보내졌을 수 있습니다", 403);
  if (!(await walletOk(g.env, body.walletId, body.walletKey))) return fail("지갑 열쇠가 맞지 않습니다", 403);

  if (action === "list") {
    const mon = cleanMon(body.mon);
    const price = Number(body.price);
    if (!mon) return fail("판매할 포켓몬 정보가 올바르지 않습니다");
    if (!isInt(price, 1, PRICE_MAX)) return fail(`가격은 🪙1~${PRICE_MAX} 입니다`);
    const mine = (await listings(g)).filter((l) => l.seller === me.id && l.state !== "sold");
    if (mine.length >= LIST_MAX) return fail(`한 번에 ${LIST_MAX}마리까지 올릴 수 있습니다`);
    const now = Date.now();
    const l = { id: "l" + randomHex(6), seller: me.id, wallet: body.walletId, trainer: me.snap.trainer, mon, price, at: now, expires: now + LIST_DAYS * 86_400_000, state: "open" };
    await g.store.put("ls:" + l.id, l);
    return json({ ok: true, listing: l });
  }

  if (action === "buy") {
    const key = "ls:" + str(body.listingId, 20);
    const l = await g.store.get(key);
    if (!l) return fail("없는 매물입니다. 이미 팔렸을 수 있습니다", 404);
    if (l.state === "buying") return fail("다른 길드원이 사는 중입니다", 409);
    if (l.state !== "open" || Date.now() > l.expires) return fail("지금은 살 수 없는 매물입니다");
    if (l.seller === me.id || l.wallet === body.walletId) return fail("내 매물은 살 수 없습니다");
    await g.store.put(key, { ...l, state: "buying" }); // 동시에 두 사람이 사지 못하게
    const paid = await walletCall(g.env, body.walletId, "debit", { key: body.walletKey, amount: l.price, memo: "길드 몰 구매" });
    if (!paid.ok) {
      await g.store.put(key, l);
      return fail(paid.reason || "코인을 내지 못했습니다", paid.status === 402 ? 402 : 400);
    }
    const fee = feeOf(l.price);
    const pay = { wallet: l.wallet, amount: l.price - fee, memo: `길드 몰 판매 (수수료 ${fee})` };
    if (pay.amount > 0) {
      const r = await walletCall(g.env, l.wallet, "credit", pay);
      if (!r.ok && r.status !== 404) await g.store.put("pay:" + l.id, pay); // 다음 몰 요청 때 다시
    }
    await g.store.delete(key);
    const sales = (await g.store.get("sales")) || [];
    sales.unshift({ line: l.mon.line, grown: l.mon.grown, shiny: l.mon.shiny, price: l.price, seller: l.trainer, buyer: me.snap.trainer, at: Date.now() });
    await g.store.put("sales", sales.slice(0, SALES_KEEP));
    return json({ ok: true, mon: l.mon, price: l.price, seller: l.trainer, balance: paid.balance });
  }

  return fail("모르는 요청입니다", 404);
}
