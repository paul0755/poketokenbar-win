"use strict";
/**
 * 야생 포켓몬 — 바탕화면에 불쑥 나타나고, 몬스터볼을 던져 잡는다.
 *
 * 여기는 규칙만 있다(언제 나오나, 누가 나오나, 잡히나). 창을 띄우고 볼을 날리는
 * 건 index.js 가 한다. 규칙을 따로 두면 창 없이 확률을 시험할 수 있다.
 *
 * ── 언제 나오나 ──
 * 토큰과 묶지 않는다. 처음엔 "일하면 나온다"로 잡았는데, 돌발 이벤트는 정말
 * 아무 때나 나와야 돌발답다. 정해 둔 간격 안에서 무작위로 다음 출현을 잡는다.
 * 자리를 비운 동안 나오면 아무도 못 본 채 도망가니, 그때는 미룬다(index.js).
 *
 * 하루 상한은 둔다. 잡은 아이는 공짜 알이다 — 알은 사탕 2개다.
 */
const poke = require("./pokemon");

/** 다음 출현까지(분). cap 은 하루 최대 출현 수 */
const PACE = {
  off: null,
  rare: { min: 60, max: 180, cap: 4 },
  often: { min: 20, max: 60, cap: 10 },
};

/** 한 번 나와서 머무는 시간. 지나면 떠난다 */
const STAY_MS = 3 * 60_000;

/** 출현마다 주는 몬스터볼. 다 던지면 떠난다 */
const BALLS_PER_ENCOUNTER = 3;

/** 다음 출현까지 기다릴 시간(ms). 꺼져 있으면 null */
function nextDelay(level) {
  const p = PACE[level];
  if (!p) return null;
  return Math.round((p.min + Math.random() * (p.max - p.min)) * 60_000);
}

/**
 * 누가 나오나. 알 뽑기와 같은 포획률 가중치를 쓴다 — 흔한 아이는 자주,
 * 귀한 아이는 드물게. 이로치도 알과 같은 확률(부적이 있으면 두 배).
 */
function roll(hasCharm) {
  return {
    line: poke.roll(),
    shiny: poke.rollShiny(Boolean(hasCharm)),
    nature: poke.rollNature(),
  };
}

/**
 * 5세대 포획 공식.
 *
 *   a = (3·최대HP − 2·현재HP) × 포획률 × 볼 보정 / (3·최대HP) × 상태 보정
 *   a ≥ 255 면 확정. 아니면 흔들림마다 b/65536 확률로 버틴다
 *   b = 65536 / (255/a)^(1/4)
 *
 * 체력이 가득 찬 상태면 a = 포획률 × 볼 / 3 이다. 몬스터볼 한 번에
 * 꼬렛(255)은 44%, 미뇽(45)은 12%, 전설(3)은 2% 쯤 된다.
 * hp 는 남은 비율(0~1). 결투로 깎는 건 다음 단계다 — 지금은 늘 1.
 */
function odds(captureRate, ball = 1, hp = 1, status = 1) {
  const a = Math.min(255, Math.floor((((3 - 2 * hp) * captureRate * ball) / 3) * status));
  if (a >= 255) return { a, shake: 1, total: 1 };
  const b = Math.floor(65536 / Math.pow(255 / Math.max(1, a), 0.25));
  const shake = b / 65536;
  return { a, shake, total: Math.pow(shake, 3) };
}

/**
 * 한 번 던진 결과. 원작처럼 세 번 흔들리고, 다 버티면 잡힌다.
 * shakes 는 버틴 횟수(0~3) — 화면은 그만큼 흔들고 나서 결과를 보여 준다.
 */
function throwBall(captureRate, ball = 1, hp = 1, status = 1, rng = Math.random) {
  const o = odds(captureRate, ball, hp, status);
  let shakes = 0;
  while (shakes < 3 && rng() < o.shake) shakes++;
  return { shakes, caught: shakes === 3, chance: o.total };
}

/**
 * 방해 금지 시간 — 회의·발표 중에 바탕화면에서 포켓몬이 튀어나오면 곤란하다.
 * 그 시간에는 저절로 나오지 않는다. 직접 부르는 건 막지 않는다(사람이 원한 거다).
 *
 * q = { enabled, from, to } — 시(0~23). 22시~8시처럼 자정을 넘겨도 된다.
 * from 과 to 가 같으면 비어 있는 구간으로 본다 — "하루 종일"로 읽으면 켜는 순간
 * 아무것도 안 나와서 고장처럼 보인다. 그럴 거면 "안 나오기"를 고르면 된다.
 */
function inQuiet(now, q) {
  if (!q || !q.enabled || q.from === q.to) return false;
  const h = now.getHours() + now.getMinutes() / 60;
  return q.from < q.to ? h >= q.from && h < q.to : h >= q.from || h < q.to;
}

/** 방해 금지가 끝나는 시각까지(ms). 지금 방해 금지가 아니면 0 */
function quietEndsIn(now, q) {
  if (!inQuiet(now, q)) return 0;
  const end = new Date(now);
  end.setHours(q.to, 0, 0, 0);
  if (end <= now) end.setDate(end.getDate() + 1); // 자정을 넘기는 구간
  return end - now;
}

/**
 * 놓쳤을 때 도망칠 확률. 귀한 아이일수록 잘 도망친다 — 10% ~ 35%.
 * 볼을 다 쓰기 전에 떠날 수 있어야 "한 번에 잡아야 하는" 긴장이 생긴다.
 */
const fleeChance = (captureRate) => 0.1 + ((255 - Math.min(255, captureRate)) / 255) * 0.25;

module.exports = { PACE, STAY_MS, BALLS_PER_ENCOUNTER, nextDelay, roll, odds, throwBall, fleeChance, inQuiet, quietEndsIn };
