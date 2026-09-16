"use strict";
const { app, Tray, BrowserWindow, Menu, ipcMain, nativeImage, screen, Notification, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const usage = require("./usage");
const poke = require("./pokemon");
const limits = require("./limits");
const notify = require("./notify");

const CACHE = path.join(app.getPath("userData"), "sprites");
const SAVE = path.join(app.getPath("userData"), "save.json");

let tray = null;
let win = null; // 팝오버
let pet = null; // 데스크톱 펫
let lastStats = null;

/**
 * 이상한사탕 1개의 값. 하루 5천만~1억을 쓰면 하루 2~4개다.
 *
 * 뽑기가 공짜 버튼이면 희귀도가 의미를 잃는다. ★5가 1/739여도
 * 1초에 한 번 누르면 10분이면 나온다. 화폐는 "실제로 쓴 토큰"이어야 한다.
 */
const CANDY_PER = 25_000_000;

/**
 * 상점.
 *
 * 알 값은 "며칠 치인가"로 잡았다. 하루 3개쯤 들어오므로
 * 일반 알은 하루에 한 번, 전설 알은 열흘쯤 모아야 한다.
 * 슈퍼·전설 알이 등급을 "확정"하는 것은 가중치를 없애는 게 아니라
 * 후보를 그 등급 이상으로 좁히는 것이다 — ★4 알에서 ★5도 나온다.
 */
const SHOP = [
  { id: "egg", name: "포켓몬 알", cost: 3, desc: "평범한 알. 등급은 운에 맡긴다", icon: "🥚" },
  { id: "egg-super", name: "슈퍼 알", cost: 12, desc: "★3 이상 확정", icon: "🥚" },
  { id: "egg-legend", name: "전설 알", cost: 35, desc: "★4 이상 확정", icon: "🥚" },
  { id: "mint", name: "민트", cost: 2, desc: "성격만 다시 뽑는다. 키우던 건 그대로", icon: "🌿" },
  { id: "charm", name: "반짝이는 부적", cost: 60, desc: "이로치 확률 2배. 한 번만 살 수 있다", icon: "✨", once: true },
];

let save = {
  lineIndex: null, // null이면 아직 안 뽑은 것. 첫 실행에 뽑는다
  natureIndex: null,
  /**
   * 이 개체를 받은 시점의 누적 토큰.
   *
   * 성장은 (누적 - bornAt)으로 잰다. 누적 전체로 재면 뭘 뽑든
   * 곧바로 최종 진화라서, 키우는 게임인데 키우는 과정이 없어진다.
   */
  bornAt: 0,
  candySpent: 0, // 지금까지 쓴 사탕
  candyBonus: 0, // 졸업·한도 달성으로 받은 보너스 사탕
  charm: false, // 반짝이는 부적 보유
  shiny: false, // 지금 키우는 개체가 이로치인가
  seen: [], // 한 번이라도 받아본 라인 (도감 진행도)
  /**
   * 라인별로 실제 도달한 최고 단계. { lineIndex: stageIndex }
   *
   * 이게 없으면 도감이 최종 진화 모습만 보여준다 —
   * 아직 파비코인데 도감엔 파비코리로 뜨는 문제가 생긴다.
   * 안 키운 모습을 가진 것처럼 보여주면 도감이 거짓말을 한다.
   */
  maxStage: {},
  graduated: [], // 마스터까지 키운 개체들
  graduatedAt: null, // 마지막으로 졸업 처리한 개체의 bornAt (중복 기록 방지)
  /**
   * 바탕화면 펫으로 띄울 라인. null이면 지금 키우는 개체를 따라간다.
   *
   * 키우는 건 한 마리뿐이지만, 도감에 있는 아이를 대표로 세워두고
   * 싶을 수 있다. 키우는 개체와 보이는 개체를 분리한다.
   */
  petLine: null,
  petVisible: false,
  petPos: null,
  wanderLevel: "rare",

  /* ---- 설정 ---- */
  notifyEnabled: true,
  warnPercent: 80, // Codex 주간 한도 경고 기준
  petSize: 128,
  pollMinutes: 0.5, // 갱신 주기(분). 0.5 = 30초
  autoLaunch: false,
};

let hadSave = false; // 세이브 파일이 원래 있었는가 (첫 실행 vs 이전 버전 이어받기)

function loadSave() {
  try {
    // BOM이 붙은 파일(PowerShell 등 다른 도구가 쓴 경우)에서 JSON.parse가 터진다.
    // 그러면 설정이 통째로 기본값으로 떨어지는데, 오류도 안 나서 원인을 찾기 어렵다.
    const raw = fs.readFileSync(SAVE, "utf8");
    const clean = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const loaded = JSON.parse(clean);
    hadSave = true;
    save = { ...save, ...loaded };
    // bornAt이 없던 시절의 세이브는 0으로 둔다 —
    // 지금 키우던 개체가 갑자기 알로 돌아가면 진행을 빼앗는 셈이다.
    if (typeof loaded.bornAt !== "number") save.bornAt = 0;
  } catch {
    /* 첫 실행 */
  }
  if (!Array.isArray(save.seen)) save.seen = [];
  if (!Array.isArray(save.graduated)) save.graduated = [];
  if (!save.maxStage || typeof save.maxStage !== "object") save.maxStage = {};
}

function writeSave() {
  try {
    fs.writeFileSync(SAVE, JSON.stringify(save), "utf8");
  } catch {
    /* 저장 실패는 치명적이지 않다 */
  }
}

const fmt = (n) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + "B"
  : n >= 1e6 ? (n / 1e6).toFixed(1) + "M"
  : n >= 1e3 ? (n / 1e3).toFixed(1) + "K"
  : String(n);

/** 남은 시간을 "3일 4시간" / "4시간 10분" 형태로 */
const hm = (ms) => {
  if (ms <= 0) return "곧";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return Math.floor(h / 24) + "일 " + (h % 24) + "시간";
  return h ? h + "시간 " + m + "분" : m + "분";
};

let lastTotal = 0; // 마지막으로 읽은 누적 토큰. 뽑기 비용 계산에 쓴다.

/** 이상한사탕 현황 */
function candy(total = lastTotal) {
  const fromTokens = Math.floor(total / CANDY_PER);
  const earned = fromTokens + (save.candyBonus ?? 0);
  return {
    earned,
    spent: save.candySpent ?? 0,
    left: Math.max(0, earned - (save.candySpent ?? 0)),
    per: CANDY_PER,
    // 다음 사탕까지 얼마나 남았나
    toNext: CANDY_PER - (total % CANDY_PER),
  };
}

/** 새 개체를 받는다. minStars가 있으면 그 등급 이상으로 뽑는다. */
function hatch(minStars = 0) {
  save.lineIndex =
    minStars > 0 ? poke.rollAtLeast(minStars, save.lineIndex) : poke.roll(save.lineIndex);
  save.natureIndex = poke.rollNature();
  save.shiny = poke.rollShiny(Boolean(save.charm));
  save.bornAt = lastTotal; // 새 개체는 지금부터 0에서 자란다
  save.graduatedAt = null;
  // 떠나보낸 아이를 계속 펫으로 세워둘 수는 없다
  if (save.petLine != null && !ownedLines().has(save.petLine)) save.petLine = null;
  if (!save.seen.includes(save.lineIndex)) save.seen.push(save.lineIndex);
}

/**
 * 상점 구매. 사탕이 모자라면 아무 일도 일어나지 않는다.
 * 살 수 있는지 판단은 여기서만 한다 — 렌더러가 보낸 값을 믿지 않는다.
 */
function buy(itemId) {
  const item = SHOP.find((x) => x.id === itemId);
  if (!item) return { ok: false, reason: "없는 물건" };
  if (item.once && save.charm) return { ok: false, reason: "이미 가지고 있습니다" };
  const c = candy();
  if (c.left < item.cost) return { ok: false, reason: "사탕이 모자랍니다" };

  save.candySpent = (save.candySpent ?? 0) + item.cost;
  let msg = "";
  if (itemId === "egg") { hatch(0); msg = "새 알을 받았습니다"; }
  else if (itemId === "egg-super") { hatch(3); msg = "슈퍼 알 — ★3 이상"; }
  else if (itemId === "egg-legend") { hatch(4); msg = "전설 알 — ★4 이상"; }
  else if (itemId === "mint") {
    save.natureIndex = poke.rollNature();
    msg = "성격이 " + poke.NATURES[save.natureIndex].name + "(으)로 바뀌었습니다";
  } else if (itemId === "charm") { save.charm = true; msg = "이로치 확률이 2배가 됩니다"; }

  writeSave();
  refresh();
  pushDex();
  pushShop();
  return { ok: true, message: msg, shiny: itemId.startsWith("egg") && save.shiny };
}

/**
 * 마스터에 도달했으면 도감에 졸업 기록을 남기고 공짜 뽑기를 준다.
 *
 * graduatedAt으로 개체를 특정해 중복 기록을 막는다 —
 * 30초마다 도는 refresh가 같은 개체를 계속 졸업시키면 안 된다.
 */
/** 지금 라인이 도달한 최고 단계를 갱신한다. 내려가지는 않는다. */
function recordStage(grown) {
  const li = save.lineIndex ?? 0;
  const st = poke.stageFor(grown);
  if ((save.maxStage[li] ?? -1) >= st) return;
  save.maxStage[li] = st;
  writeSave();
}

function checkGraduation(grown) {
  const idx = poke.stageFor(grown);
  if (poke.STAGES[idx].key !== "master") return;
  if (save.graduatedAt === save.bornAt) return; // 이미 처리한 개체

  const mon = poke.describe(grown, save.lineIndex ?? 0, { shiny: save.shiny });
  const r = poke.rarityOf(save.lineIndex ?? 0);
  save.graduated.push({
    line: save.lineIndex,
    name: mon.name,
    dexId: mon.dexId,
    stars: r.stars,
    nature: (poke.NATURES[save.natureIndex ?? 0] || {}).name ?? null,
    grown,
    at: new Date().toISOString().slice(0, 10),
  });
  save.graduatedAt = save.bornAt;
  save.candyBonus = (save.candyBonus ?? 0) + 5; // 졸업 보상
  writeSave();
}

async function buildStats() {
  const u = usage.collect();
  lastTotal = u.total;
  // 성장은 이 개체를 받은 뒤 쓴 토큰으로만 잰다.
  const grown = Math.max(0, u.total - (save.bornAt ?? 0));
  recordStage(grown);
  checkGraduation(grown);
  const mon = poke.describe(grown, save.lineIndex ?? 0);
  // 트레이는 정적 PNG(nativeImage는 GIF를 움직이지 못한다), 화면은 애니메이션 GIF.
  const still = await poke.spriteWithFallback(mon, CACHE, "still");
  const anim = await poke.spriteWithFallback(mon, CACHE, "anim");
  // events는 한도 계산에만 쓴다. 수천 건을 30초마다 IPC로 보낼 이유가 없다.
  const { events, ...slim } = u;

  // 펫은 대표로 지정한 아이를 보여준다. 없으면 키우는 개체 그대로.
  let petMon = mon;
  let petStill = still;
  let petAnim = anim;
  if (save.petLine != null && save.petLine !== save.lineIndex) {
    const L = poke.LINES[save.petLine];
    if (L) {
      const st = Math.max(1, save.maxStage[save.petLine] ?? 1);
      const target = { dexId: L.ids[st], isShiny: false };
      petMon = { name: L.names[st], stage: poke.STAGES[st] };
      petStill = await poke.spriteWithFallback(target, CACHE, "still");
      petAnim = await poke.spriteWithFallback(target, CACHE, "anim");
    }
  }

  return {
    usage: slim,
    mon,
    stillPath: still,
    // 렌더러에 Windows 경로를 넘기면 역슬래시를 직접 다뤄야 한다. 변환은 Node가 한다.
    stillUrl: still ? pathToFileURL(still).href : null,
    animUrl: anim ? pathToFileURL(anim).href : null,
    petName: petMon.name,
    petStillUrl: petStill ? pathToFileURL(petStill).href : null,
    petAnimUrl: petAnim ? pathToFileURL(petAnim).href : null,
    petLine: save.petLine,
    dex: {
      seen: save.seen.length,
      total: poke.LINES.length,
      graduated: save.graduated.length,
    },
    grown,
    petSize: save.petSize,
    candy: candy(u.total),
    charm: Boolean(save.charm),
    shiny: Boolean(save.shiny),
    tree: await buildTree(grown),
    limits: limits.summarize(u),
    rarity: { ...poke.rarityOf(save.lineIndex ?? 0), chance: poke.rollChance(save.lineIndex ?? 0) },
    nature: poke.NATURES[save.natureIndex ?? 0] ?? null,
  };
}

/** 진화 트리에 쓸 작은 정적 스프라이트를 붙인다. 못 받으면 그림 없이 이름만 나온다. */
async function buildTree(grown) {
  const nodes = poke.evolutionTree(save.lineIndex ?? 0, grown);
  return Promise.all(
    nodes.map(async (n) => {
      const p = await poke.spriteWithFallback(
        { dexId: n.dexId, isShiny: n.isShiny },
        CACHE,
        "still",
      );
      return { ...n, url: p ? pathToFileURL(p).href : null };
    }),
  );
}

/** Windows 트레이는 macOS 메뉴바와 달리 글자를 못 띄운다. 숫자는 툴팁으로 간다. */
function applyTray(s) {
  if (!tray) return;
  if (s.stillPath) {
    const img = nativeImage.createFromPath(s.stillPath).resize({ width: 16, height: 16 });
    if (!img.isEmpty()) tray.setImage(img);
  }
  const p = s.mon.progress;
  const b = s.limits && s.limits.block;
  const q = s.limits && s.limits.codex;
  tray.setToolTip(
    s.mon.name + " · " + s.mon.stage.label +
      (s.rarity ? "  " + "★".repeat(s.rarity.stars) : "") +
      (s.nature ? "  (" + s.nature.name + ")" : "") + "\n" +
      "오늘 " + fmt(s.usage.today) + " · 누적 " + fmt(s.usage.total) +
      (p.next ? "\n다음(" + p.next + ")까지 " + fmt(p.remaining) : "\n최고 단계입니다") +
      (b ? "\n5시간 창 " + fmt(b.used) + " · " + hm(b.remainingMs) + " 남음" : "") +
      (q ? "\nCodex 주간 " + q.percent + "%" : ""),
  );
}

function push(target, s) {
  if (target && !target.isDestroyed()) target.webContents.send("stats", s);
}

let prevSnap = null;

/** 상태가 바뀐 순간에만 알린다. 자세한 판단은 notify.js가 한다. */
function sendNotifications(s) {
  if (!save.notifyEnabled || !Notification.isSupported()) return;
  const cur = {
    ...notify.snapshot({ ...s, bornAtRaw: save.bornAt }),
    name: s.mon.name,
    stageLabel: s.mon.stage.label,
    body: s.mon.progress.next
      ? s.mon.progress.next + "까지 " + fmt(s.mon.progress.remaining)
      : "최고 단계입니다",
    resetIn: s.limits && s.limits.codex ? hm(s.limits.codex.resetAt - Date.now()) : null,
  };
  for (const n of notify.pending(prevSnap, cur, { warnPercent: save.warnPercent })) {
    try {
      new Notification({ title: n.title, body: n.body, silent: false }).show();
    } catch (e) {
      console.error("[notify]", e.message);
    }
  }
  prevSnap = cur;
}

async function refresh() {
  try {
    const s = await buildStats();
    lastStats = s;
    sendNotifications(s);
    push(win, s);
    push(pet, s);
    try {
      applyTray(s);
    } catch (e) {
      console.error("[tray]", e.message);
    }
  } catch (e) {
    console.error("[refresh 실패]", e && e.stack ? e.stack : e);
  }
}

/** 렌더러 오류는 메인 stdout에 안 나온다. 끌어오지 않으면 조용히 죽는다. */
function logConsole(tag) {
  return (_e, lvl, msg, line, src) =>
    console.log("[" + tag + ":" + lvl + "] " + msg + " (" + src + ":" + line + ")");
}

/* ---------------- 팝오버 ---------------- */

function createWindow() {
  // 700px가 늘 들어간다는 보장이 없다. 작업 영역을 넘지 않게 자르고,
  // 잘린 만큼은 본문 스크롤이 받아준다.
  const area = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: 340,
    height: Math.max(420, Math.min(700, area.height - 80)),
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  // 최초 refresh가 로드보다 빠르면 그 send는 허공에 사라진다. 로드 후 한 번 더 민다.
  win.webContents.on("did-finish-load", () => (lastStats ? push(win, lastStats) : refresh()));
  win.webContents.on("console-message", logConsole("renderer"));
  win.on("blur", () => win.hide()); // 팝오버답게 포커스를 잃으면 닫는다
}

function showNearTray() {
  const b = tray.getBounds();
  const area = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea;
  const size = win.getSize();
  const w = size[0];
  const h = size[1];
  const x = Math.min(Math.max(area.x, Math.round(b.x + b.width / 2 - w / 2)), area.x + area.width - w);
  const y = b.y > area.y + area.height / 2 ? b.y - h - 8 : b.y + b.height + 8;
  win.setPosition(x, Math.min(Math.max(area.y, y), area.y + area.height - h));
  win.show();
  win.focus();
}

/* ---------------- 도감 ---------------- */

let dexWin = null;

/**
 * 도감 데이터.
 *
 * 안 만난 종은 이름도 그림도 넘기지 않는다 — 렌더러에 보내놓고 CSS로만
 * 가리면 개발자 도구로 다 보인다. 모으는 재미가 거기서 끝난다.
 * 스프라이트도 만난 것만 받는다. 221개를 미리 받을 이유가 없다.
 */
/**
 * 보유한 라인.
 *
 * 도감에 있다고 가진 게 아니다 — 도감은 "만난 적 있다"는 기록이다.
 * 실제로 가진 건 지금 키우는 아이와, 마스터까지 키워 졸업시킨 아이들이다.
 * 뽑기로 갈아치운 아이는 떠나보낸 것이므로 보유가 아니다.
 */
function ownedLines() {
  const set = new Set(save.graduated.map((g) => g.line));
  if (save.lineIndex != null) set.add(save.lineIndex);
  return set;
}

async function buildDex() {
  const owned = ownedLines();
  const gradCount = new Map();
  for (const g of save.graduated) gradCount.set(g.line, (gradCount.get(g.line) ?? 0) + 1);

  const entries = await Promise.all(
    poke.LINES.map(async (L, i) => {
      const seen = save.seen.includes(i);
      if (!seen) return { index: i, seen: false };
      const r = poke.rarityOf(i);
      // 실제로 도달한 단계로 보여준다. 최종 진화 모습을 박아두면
      // 아직 못 키운 모습을 가진 것처럼 보인다.
      const st = Math.max(1, save.maxStage[i] ?? 1);
      const dexId = L.ids[st];
      const p = await poke.spriteWithFallback({ dexId, isShiny: false }, CACHE, "still");
      // 이 라인에서 아직 더 클 수 있는지 (도감에 "미완성" 표시용)
      const top = L.ids.lastIndexOf(L.ids[L.ids.length - 1]);
      return {
        index: i,
        seen: true,
        name: L.names[st],
        stage: poke.STAGES[st].label,
        complete: L.ids[st] === L.ids[3], // 최종 진화 모습까지 봤는가
        stars: r.stars,
        label: r.label,
        graduated: gradCount.get(i) ?? 0,
        owned: owned.has(i),
        isPet: save.petLine == null ? i === save.lineIndex : i === save.petLine,
        url: p ? pathToFileURL(p).href : null,
      };
    }),
  );

  return {
    entries,
    seen: save.seen.length,
    total: poke.LINES.length,
    graduated: save.graduated.length,
  };
}

async function pushDex() {
  if (!dexWin || dexWin.isDestroyed()) return;
  try {
    dexWin.webContents.send("dex", await buildDex());
  } catch (e) {
    console.error("[dex]", e && e.message);
  }
}

function openDex() {
  if (dexWin && !dexWin.isDestroyed()) {
    dexWin.show();
    dexWin.focus();
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  dexWin = new BrowserWindow({
    width: Math.min(560, area.width - 80),
    height: Math.min(640, area.height - 80),
    frame: false,
    resizable: true,
    minWidth: 340,
    minHeight: 320,
    skipTaskbar: false, // 도감은 제대로 된 창이다. 작업표시줄에 있어야 다시 찾는다
    backgroundColor: "#14151a",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  dexWin.loadFile(path.join(__dirname, "..", "renderer", "dex.html"));
  dexWin.webContents.on("did-finish-load", pushDex);
  dexWin.webContents.on("console-message", logConsole("dex"));
  dexWin.on("closed", () => (dexWin = null));
}

/* ---------------- 상점 ---------------- */

let shopWin = null;

function pushShop() {
  if (!shopWin || shopWin.isDestroyed()) return;
  const c = candy();
  shopWin.webContents.send("shop", {
    candy: c,
    charm: Boolean(save.charm),
    items: SHOP.map((x) => ({
      ...x,
      owned: x.once ? Boolean(save.charm) : false,
      afford: c.left >= x.cost,
    })),
  });
}

function openShop() {
  if (shopWin && !shopWin.isDestroyed()) {
    shopWin.show();
    shopWin.focus();
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  shopWin = new BrowserWindow({
    width: 420,
    height: Math.min(560, area.height - 80),
    frame: false,
    resizable: true,
    minWidth: 340,
    minHeight: 320,
    backgroundColor: "#14151a",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  shopWin.loadFile(path.join(__dirname, "..", "renderer", "shop.html"));
  shopWin.webContents.on("did-finish-load", pushShop);
  shopWin.webContents.on("console-message", logConsole("shop"));
  shopWin.on("closed", () => (shopWin = null));
}

/* ---------------- 설정 ---------------- */

let setWin = null;
let pollTimer = null;

function settingsPayload() {
  return {
    notifyEnabled: save.notifyEnabled,
    warnPercent: save.warnPercent,
    petSize: save.petSize,
    wanderLevel: save.wanderLevel,
    pollMinutes: save.pollMinutes,
    autoLaunch: save.autoLaunch,
    dataPath: app.getPath("userData"),
  };
}

function pushSettings() {
  if (setWin && !setWin.isDestroyed()) setWin.webContents.send("settings", settingsPayload());
}

/** 폴링 주기를 다시 건다. 설정이 바뀌면 즉시 반영되어야 한다. */
function restartPolling() {
  if (pollTimer) clearInterval(pollTimer);
  const ms = Math.max(10_000, (save.pollMinutes ?? 0.5) * 60_000);
  pollTimer = setInterval(refresh, ms);
}

function applySettings(patch) {
  Object.assign(save, patch);
  writeSave();

  if ("wanderLevel" in patch && pet && !pet.isDestroyed()) startWander();
  if ("petSize" in patch && pet && !pet.isDestroyed()) {
    pet.setSize(save.petSize, save.petSize);
    push(pet, { petSize: save.petSize });
  }
  if ("pollMinutes" in patch) restartPolling();
  if ("autoLaunch" in patch) {
    // 패키징 전(개발 중 electron.exe 실행)에는 등록해도 의미가 없다.
    try {
      app.setLoginItemSettings({ openAtLogin: Boolean(save.autoLaunch) });
    } catch (e) {
      console.error("[autoLaunch]", e.message);
    }
  }
  pushSettings();
  refresh();
}

function openSettings() {
  if (setWin && !setWin.isDestroyed()) {
    setWin.show();
    setWin.focus();
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  setWin = new BrowserWindow({
    width: 420,
    height: Math.min(620, area.height - 80),
    frame: false,
    resizable: true,
    minWidth: 340,
    minHeight: 320,
    backgroundColor: "#14151a",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  setWin.loadFile(path.join(__dirname, "..", "renderer", "settings.html"));
  setWin.webContents.on("did-finish-load", pushSettings);
  setWin.webContents.on("console-message", logConsole("settings"));
  setWin.on("closed", () => (setWin = null));
}

/**
 * 진행 초기화. 토큰 기록은 로그가 원본이라 지워지지 않는다 —
 * 지워지는 건 이 앱이 만든 것(도감·졸업·뽑기권·현재 개체)뿐이다.
 */
function resetProgress() {
  save.lineIndex = poke.roll(null);
  save.natureIndex = poke.rollNature();
  save.bornAt = lastTotal; // 지금부터 알로 다시 시작
  save.candySpent = 0;
  save.candyBonus = 0;
  save.charm = false;
  save.shiny = false;
  save.seen = [save.lineIndex];
  save.graduated = [];
  save.graduatedAt = null;
  prevSnap = null; // 초기화 직후 "진화했습니다"가 뜨지 않게
  writeSave();
  refresh();
  pushDex();
}


/* ---------------- 데스크톱 펫 ---------------- */

// 펫 크기는 설정에서 바뀐다 (save.petSize)
const petW = () => save.petSize ?? 128;

/**
 * 배회 강도. 기본은 "가끔" — 데스크톱 펫이 쉬지 않고 돌아다니면
 * 귀여운 게 아니라 작업에 거슬린다. 대부분의 시간은 가만히 있어야 한다.
 *
 * pause  다음 목적지를 잡기까지 쉬는 시간(ms)
 * range  한 번에 움직이는 거리(px, 좌우/상하)
 * px/ms  이동 속도
 */
const WANDER = {
  off: null,
  rare: { pause: 35_000, range: [150, 90], px: 1, ms: 50 },
  often: { pause: 12_000, range: [380, 220], px: 2, ms: 40 },
};

let wanderTarget = null;
let wanderTimer = null;
let stepTimer = null;

/**
 * 우리가 옮긴 좌표. 'moved' 이벤트가 우리 때문인지 사용자가 끌어서인지 가린다.
 *
 * 불린 플래그로는 안 된다 — setPosition 직후 플래그를 되돌려도 'moved'는
 * OS 메시지 루프를 거쳐 그 뒤에 도착한다. 그러면 우리 이동이 전부
 * "사용자가 끌었다"로 오인돼 배회 목표가 계속 취소되고 펫이 버벅인다.
 */
let selfPos = null;

function createPet() {
  const area = screen.getPrimaryDisplay().workArea;
  const pos = save.petPos || {
    x: area.x + area.width - petW() - 40,
    y: area.y + area.height - petW() - 60,
  };
  pet = new BrowserWindow({
    width: petW(),
    height: petW(),
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  pet.setAlwaysOnTop(true, "screen-saver"); // 전체화면 위에도 뜨게
  pet.loadFile(path.join(__dirname, "..", "renderer", "pet.html"));
  pet.webContents.on("did-finish-load", () => lastStats && push(pet, lastStats));
  pet.webContents.on("console-message", logConsole("pet"));

  pet.on("moved", () => {
    if (!pet || pet.isDestroyed()) return;
    const p = pet.getPosition();
    if (selfPos && p[0] === selfPos.x && p[1] === selfPos.y) return; // 우리가 옮긴 것
    save.petPos = { x: p[0], y: p[1] };
    writeSave();
    wanderTarget = null; // 사용자가 놓은 자리에서 다시 시작한다
  });

  startWander();
}

function startWander() {
  stopWander();
  const cfg = WANDER[save.wanderLevel];
  if (!cfg || !pet || pet.isDestroyed()) return;

  const pickTarget = () => {
    if (!pet || pet.isDestroyed()) return;
    const p = pet.getPosition();
    const area = screen.getDisplayNearestPoint({ x: p[0], y: p[1] }).workArea;
    const dx = (Math.random() - 0.5) * cfg.range[0];
    const dy = (Math.random() - 0.5) * cfg.range[1];
    wanderTarget = {
      x: Math.min(Math.max(area.x, Math.round(p[0] + dx)), area.x + area.width - petW()),
      y: Math.min(Math.max(area.y, Math.round(p[1] + dy)), area.y + area.height - petW()),
    };
  };

  wanderTimer = setInterval(pickTarget, cfg.pause);
  setTimeout(pickTarget, 4000);

  stepTimer = setInterval(() => {
    if (!pet || pet.isDestroyed() || !wanderTarget) return;
    const p = pet.getPosition();
    const dx = wanderTarget.x - p[0];
    const dy = wanderTarget.y - p[1];
    if (Math.abs(dx) <= cfg.px && Math.abs(dy) <= cfg.px) {
      wanderTarget = null; // 도착. 다음 pause 동안 가만히 있는다
      return;
    }
    const step = (d) => Math.sign(d) * Math.min(Math.abs(d), cfg.px);
    const nx = Math.round(p[0] + step(dx));
    const ny = Math.round(p[1] + step(dy));
    selfPos = { x: nx, y: ny };
    pet.setPosition(nx, ny);
    push(pet, { facing: dx < 0 ? "left" : "right" }); // 진행 방향으로 뒤집게
  }, cfg.ms);
}

function stopWander() {
  if (wanderTimer) clearInterval(wanderTimer);
  if (stepTimer) clearInterval(stepTimer);
  wanderTimer = null;
  stepTimer = null;
  wanderTarget = null;
}

function togglePet(on) {
  save.petVisible = on === undefined ? !save.petVisible : on;
  writeSave();
  if (save.petVisible) {
    if (!pet || pet.isDestroyed()) createPet();
    pet.showInactive();
  } else if (pet && !pet.isDestroyed()) {
    stopWander();
    pet.destroy();
    pet = null;
  }
}

function setWanderLevel(level) {
  save.wanderLevel = level;
  writeSave();
  if (pet && !pet.isDestroyed()) startWander();
}

/* ---------------- 앱 ---------------- */

function buildMenu() {
  const lvl = (label, key) => ({
    label,
    type: "radio",
    checked: save.wanderLevel === key,
    click: () => setWanderLevel(key),
  });
  return Menu.buildFromTemplate([
    { label: save.petVisible ? "펫 숨기기" : "바탕화면에 펫 띄우기", click: () => togglePet() },
    {
      label: "펫 움직임",
      submenu: [lvl("가만히 있기", "off"), lvl("가끔 (기본)", "rare"), lvl("자주", "often")],
    },
    { type: "separator" },
    { label: "🍬 상점 (사탕 " + candy().left + ")", click: openShop },
    { label: "📖 도감 열기", click: openDex },
    { label: "⚙️ 설정", click: openSettings },
    { label: "새로고침", click: refresh },
    { type: "separator" },
    { label: "종료", click: () => app.quit() },
  ]);
}

app.whenReady().then(async () => {
  loadSave();

  // 첫 알은 공짜다. 고정 1번으로 시작하면 누구나 같은 포켓몬을 받는다.
  if (save.lineIndex === null || save.lineIndex === undefined) {
    save.lineIndex = poke.roll(null);
    if (!save.seen.includes(save.lineIndex)) save.seen.push(save.lineIndex);
    // 새로 설치한 경우엔 지금부터 0에서 키운다. 이미 쌓인 누적 토큰으로
    // 곧바로 최종 진화가 되면 첫 화면부터 키울 게 없다.
    if (!hadSave) save.bornAt = usage.collect().total;
    writeSave();
  }
  // 성격은 뒤에 추가된 값이라, 기존 세이브에는 없다. 그때 한 번 뽑아준다.
  if (save.natureIndex === null || save.natureIndex === undefined) {
    save.natureIndex = poke.rollNature();
    writeSave();
  }

  // Windows 트레이는 빈 아이콘을 받으면 아무것도 표시하지 않는다.
  const fallback = nativeImage
    .createFromPath(path.join(__dirname, "..", "..", "assets", "pokeball.png"))
    .resize({ width: 16, height: 16 });
  tray = new Tray(fallback);
  tray.setToolTip("PokeTokenBar — 불러오는 중…");

  createWindow();
  tray.on("click", () => (win.isVisible() ? win.hide() : showNearTray()));
  tray.on("right-click", () => tray.popUpContextMenu(buildMenu()));

  ipcMain.on("request-stats", refresh);
  ipcMain.on("quit", () => app.quit());
  ipcMain.on("hide-popover", () => win && !win.isDestroyed() && win.hide());
  ipcMain.on("toggle-pet", () => togglePet());
  ipcMain.on("open-shop", openShop);
  ipcMain.on("request-shop", pushShop);
  ipcMain.on("close-shop", () => shopWin && !shopWin.isDestroyed() && shopWin.close());
  ipcMain.handle("buy", (_e, id) => buy(id));
  ipcMain.on("open-dex", openDex);
  ipcMain.on("request-dex", pushDex);
  ipcMain.on("close-dex", () => dexWin && !dexWin.isDestroyed() && dexWin.close());
  ipcMain.on("set-pet-line", (_e, line) => {
    // 보유하지 않은 아이는 세울 수 없다. 렌더러가 보낸 값을 그대로 믿지 않는다.
    if (line != null && !ownedLines().has(line)) return;
    // 키우는 개체를 고르면 "따라가기"(null)로 되돌린다 — 그게 기본 상태다
    save.petLine = line === save.lineIndex ? null : line;
    writeSave();
    if (save.petVisible && (!pet || pet.isDestroyed())) togglePet(true);
    refresh();
    pushDex();
  });
  ipcMain.on("open-settings", openSettings);
  ipcMain.on("request-settings", pushSettings);
  ipcMain.on("set-settings", (_e, patch) => applySettings(patch || {}));
  ipcMain.on("close-settings", () => setWin && !setWin.isDestroyed() && setWin.close());
  ipcMain.on("open-data-folder", () => shell.openPath(app.getPath("userData")));
  ipcMain.on("reset-progress", resetProgress);

  // 펫을 클릭하면 팝오버를 연다. 펫 옆이 아니라 트레이 옆에 띄운다 —
  // 펫은 화면 아무 데나 있을 수 있어서, 늘 같은 자리에 뜨는 편이 덜 헷갈린다.
  ipcMain.on("pet-click", () => {
    if (win.isVisible()) win.hide();
    else showNearTray();
  });

  // 펫 드래그. 창 전체가 app-region:drag면 클릭 이벤트가 오지 않으므로
  // 드래그를 직접 구현하고, 움직임이 거의 없으면 클릭으로 친다.
  ipcMain.on("pet-drag", (_e, { x, y }) => {
    if (!pet || pet.isDestroyed()) return;
    stopWander(); // 끄는 동안 우리가 끼어들면 안 된다
    pet.setPosition(Math.round(x), Math.round(y));
  });

  ipcMain.on("pet-drag-end", () => {
    if (!pet || pet.isDestroyed()) return;
    const p = pet.getPosition();
    save.petPos = { x: p[0], y: p[1] };
    writeSave();
    startWander(); // 놓은 자리에서 다시 시작
  });

  await refresh();
  if (save.petVisible) togglePet(true);
  restartPolling();
});

app.on("window-all-closed", (e) => e.preventDefault()); // 트레이 앱은 창이 없어도 산다
