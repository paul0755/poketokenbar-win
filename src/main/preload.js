"use strict";
const { contextBridge, ipcRenderer } = require("electron");

/**
 * 렌더러는 파일시스템에 직접 닿지 않는다.
 * 메인이 읽어서 정제한 값만 건네받는다.
 */
/**
 * 이 창이 맡은 개체 id. 펫 창에만 붙는다.
 *
 * 여러 마리를 동시에 띄우므로 창마다 자기가 누구인지 알아야
 * 자기 그림을 고를 수 있다. 메인이 창을 만들 때 인자로 넣어 준다.
 */
const petId = (process.argv.find((a) => a.startsWith("--ptb-pet-id=")) || "").slice(13) || null;

contextBridge.exposeInMainWorld("ptb", {
  petId,
  onStats: (cb) => ipcRenderer.on("stats", (_e, data) => cb(data)),
  request: () => ipcRenderer.send("request-stats"),
  refreshNow: () => ipcRenderer.send("refresh-now"),
  nextLine: () => ipcRenderer.send("next-line"),
  togglePet: () => ipcRenderer.send("toggle-pet"),
  quit: () => ipcRenderer.send("quit"),
  hide: () => ipcRenderer.send("hide-popover"),

  // 도감
  openDex: () => ipcRenderer.send("open-dex"),
  closeDex: () => ipcRenderer.send("close-dex"),
  requestDex: () => ipcRenderer.send("request-dex"),
  onDex: (cb) => ipcRenderer.on("dex", (_e, data) => cb(data)),
  onGoTab: (cb) => ipcRenderer.on("go-tab", (_e, name) => cb(name)),
  // 박스
  setActive: (id) => ipcRenderer.send("set-active", id),
  togglePetMember: (id) => ipcRenderer.send("toggle-pet-member", id),
  release: (id) => ipcRenderer.invoke("release", id),
  // 결투 · 나무열매. 결과(사건 목록·보상)를 받아야 하므로 invoke
  battle: (a) => ipcRenderer.invoke("battle", a),
  feedBerry: (a) => ipcRenderer.invoke("feed-berry", a),
  toggleStone: (id) => ipcRenderer.invoke("toggle-stone", id),
  // 미니룸
  roomBuy: (a) => ipcRenderer.invoke("room-buy", a),
  roomCoins: () => ipcRenderer.invoke("room-coins"),
  statueImage: (dexId) => ipcRenderer.invoke("statue-image", dexId),
  roomSet: (patch) => ipcRenderer.invoke("room-set", patch),
  // 길드
  guildCreate: (a) => ipcRenderer.invoke("guild-create", a),
  guildJoin: (a) => ipcRenderer.invoke("guild-join", a),
  guildLeave: () => ipcRenderer.invoke("guild-leave"),
  guildKick: (id) => ipcRenderer.invoke("guild-kick", id),
  guildView: () => ipcRenderer.invoke("guild-view"),
  guildBattle: (id) => ipcRenderer.invoke("guild-battle", id),
  guildShare: (on) => ipcRenderer.invoke("guild-share", on),
  guildRename: (trainer) => ipcRenderer.invoke("guild-rename", trainer),
  guildList: () => ipcRenderer.invoke("guild-list"),
  guildListing: (a) => ipcRenderer.invoke("guild-listing", a),
  hallDonate: (a) => ipcRenderer.invoke("hall-donate", a),
  hallTheme: (theme) => ipcRenderer.invoke("hall-theme", theme),
  // 코인 지갑 · 상점에 팔기 · 길드 몰
  walletInfo: () => ipcRenderer.invoke("wallet-info"),
  walletCheckin: () => ipcRenderer.invoke("wallet-checkin"),
  walletExchange: (n) => ipcRenderer.invoke("wallet-exchange", n),
  shopSell: (id) => ipcRenderer.invoke("shop-sell", id),
  marketView: () => ipcRenderer.invoke("market-view"),
  marketList: (a) => ipcRenderer.invoke("market-list", a),
  marketBuy: (id) => ipcRenderer.invoke("market-buy", id),
  marketCancel: (id) => ipcRenderer.invoke("market-cancel", id),
  battleDesktop: (a) => ipcRenderer.invoke("battle-desktop", a),
  // 친선 배틀 — 코드 만들기 · 받은 코드 보기 · 싸우기
  friendRegister: (a) => ipcRenderer.invoke("friend-register", a),
  friendInspect: (code) => ipcRenderer.invoke("friend-inspect", code),
  friendBattle: (code) => ipcRenderer.invoke("friend-battle", code),
  liveTeam: (id) => ipcRenderer.invoke("live-team", id),
  liveBattle: (code) => ipcRenderer.invoke("live-battle", code),
  // 교환 — 보내기(박스에서 빠짐) · 받기 전 보기 · 받기
  tradeSend: (id) => ipcRenderer.invoke("trade-send", id),
  tradeInspect: (code) => ipcRenderer.invoke("trade-inspect", code),
  tradeReceive: (code) => ipcRenderer.invoke("trade-receive", code),
  // 펫 창 전용 — 바탕화면 결투 장면
  onDuel: (cb) => ipcRenderer.on("duel", (_e, d) => cb(d)),
  wildSpawn: () => ipcRenderer.invoke("wild-spawn"),
  // 야생 포켓몬 · 몬스터볼 창 전용
  onWild: (cb) => ipcRenderer.on("wild", (_e, d) => cb(d)),
  onBall: (cb) => ipcRenderer.on("ball", (_e, d) => cb(d)),
  ballDragStart: (p) => ipcRenderer.send("ball-drag-start", p),
  ballDrag: (p) => ipcRenderer.send("ball-drag", p),
  ballDragEnd: (p) => ipcRenderer.send("ball-drag-end", p),
  ballClick: () => ipcRenderer.send("ball-click"),

  // 상점
  openShop: () => ipcRenderer.send("open-shop"),
  closeShop: () => ipcRenderer.send("close-shop"),
  requestShop: () => ipcRenderer.send("request-shop"),
  onShop: (cb) => ipcRenderer.on("shop", (_e, data) => cb(data)),
  // 구매는 결과를 받아야 한다 (성공/실패·이로치 여부)
  buy: (id) => ipcRenderer.invoke("buy", id),

  // 설정
  openSettings: () => ipcRenderer.send("open-settings"),
  closeSettings: () => ipcRenderer.send("close-settings"),
  requestSettings: () => ipcRenderer.send("request-settings"),
  onSettings: (cb) => ipcRenderer.on("settings", (_e, data) => cb(data)),
  setSettings: (patch) => ipcRenderer.send("set-settings", patch),
  // 역산 결과를 보여줘야 하므로 invoke
  calibrateLimit: (a) => ipcRenderer.invoke("calibrate-limit", a),
  openDataFolder: () => ipcRenderer.send("open-data-folder"),
  setDataDir: (a) => ipcRenderer.invoke("set-data-dir", a),

  // 읽을 경로
  pathReport: () => ipcRenderer.invoke("path-report"),
  pickPath: (a) => ipcRenderer.invoke("pick-path", a),
  setLogRoot: (a) => ipcRenderer.invoke("set-log-root", a),
  setQuotaFile: (a) => ipcRenderer.invoke("set-quota-file", a),
  resetProgress: () => ipcRenderer.send("reset-progress"),
  listBackups: () => ipcRenderer.invoke("list-backups"),
  restoreBackup: (file) => ipcRenderer.invoke("restore-backup", file),

  // 데스크톱 펫 전용
  petClick: () => ipcRenderer.send("pet-click"),
  petDragStart: () => ipcRenderer.send("pet-drag-start"),
  petDrag: (d) => ipcRenderer.send("pet-drag", d),
  petDragEnd: () => ipcRenderer.send("pet-drag-end"),
});
