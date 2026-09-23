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

  // 데스크톱 펫 전용
  petClick: () => ipcRenderer.send("pet-click"),
  petDragStart: () => ipcRenderer.send("pet-drag-start"),
  petDrag: (d) => ipcRenderer.send("pet-drag", d),
  petDragEnd: () => ipcRenderer.send("pet-drag-end"),
});
