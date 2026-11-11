"use strict";
/**
 * 🌏 세계 — 포켓몬 세계와 디지털 월드. 앱은 하나, 세이브는 세계마다 따로.
 *
 * 켤 때 한 번 정한다(바꾸면 앱을 다시 켠다). 모듈들이 불러오는 순간 어느 세계의 종 데이터를 쓸지
 * 알아야 해서, 데이터 폴더를 index.js 보다 먼저 스스로 찾는다(같은 순서 — 환경변수 → data-dir.txt → 기본).
 *
 * 두 세계는 같은 토큰으로 함께 자란다 — 따로 돌릴 필요가 없다. 세이브마다 "어디까지 셌나"(lastTotal)를
 * 기억하니, 다른 세계로 갔다 돌아오면 그 사이 쓴 토큰을 한꺼번에 따라잡는다. 시작하지 않은 세계는
 * 세이브가 없어 아무것도 쌓이지 않는다 — 처음 들어간 순간부터 함께 자란다.
 *
 *   world.json  { "world": "digimon" }     — 없으면 포켓몬
 *   POKETOKENBAR_WORLD=digimon              — 시험용(파일보다 먼저)
 */
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const WORLDS = {
  pokemon: { id: "pokemon", label: "포켓몬 세계", icon: "🌏", save: "save.json", backups: "backups", module: "./pokemon" },
  digimon: { id: "digimon", label: "디지털 월드", icon: "🦖", save: "save-digimon.json", backups: "backups-digimon", module: "./worlds/digimon" },
};

function dataDir() {
  const env = (process.env.POKETOKENBAR_DATA || "").trim();
  if (env) return env;
  try {
    const first = fs.readFileSync(path.join(path.dirname(app.getPath("exe")), "data-dir.txt"), "utf8").split(/\r?\n/)[0].trim();
    if (first) return first;
  } catch {}
  return app.getPath("userData");
}

const FILE = path.join(dataDir(), "world.json");

function readId() {
  const env = (process.env.POKETOKENBAR_WORLD || "").trim();
  if (WORLDS[env]) return env;
  try {
    const w = JSON.parse(fs.readFileSync(FILE, "utf8")).world;
    if (WORLDS[w]) return w;
  } catch {}
  return "pokemon";
}

const W = WORLDS[readId()];

/** 다음에 켤 세계를 적는다. 바로 바뀌지 않는다 — 부르는 쪽이 앱을 다시 켠다 */
function choose(id) {
  if (!WORLDS[id]) return false;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ world: id }), "utf8");
  return true;
}

/** 세계마다 시작했는가(세이브가 있나) — 데이터 폴더 기준 */
const started = (dir, id) => fs.existsSync(path.join(dir, WORLDS[id].save));

module.exports = {
  id: W.id,
  label: W.label,
  icon: W.icon,
  saveName: W.save,
  backupsName: W.backups,
  isDigimon: W.id === "digimon",
  pack: require(W.module),
  WORLDS,
  choose,
  started,
  envLocked: Boolean((process.env.POKETOKENBAR_WORLD || "").trim()),
};
