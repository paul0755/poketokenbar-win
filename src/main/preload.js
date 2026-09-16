"use strict";
const { contextBridge, ipcRenderer } = require("electron");

/**
 * 렌더러는 파일시스템에 직접 닿지 않는다.
 * 메인이 읽어서 정제한 값만 건네받는다.
 */
contextBridge.exposeInMainWorld("ptb", {
  onStats: (cb) => ipcRenderer.on("stats", (_e, data) => cb(data)),
  request: () => ipcRenderer.send("request-stats"),
  nextLine: () => ipcRenderer.send("next-line"),
  togglePet: () => ipcRenderer.send("toggle-pet"),
  quit: () => ipcRenderer.send("quit"),

  // 데스크톱 펫 전용
  petClick: () => ipcRenderer.send("pet-click"),
  petDrag: (pos) => ipcRenderer.send("pet-drag", pos),
  petDragEnd: () => ipcRenderer.send("pet-drag-end"),
});
