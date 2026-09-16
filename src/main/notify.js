"use strict";
/**
 * 알림.
 *
 * ── 원칙 ──
 * 알림은 방해다. 그래서 "상태가 바뀐 순간"에만 보낸다.
 * 30초마다 도는 폴링이 같은 사실을 반복해서 알리면 그때부터 전부 무시된다.
 *
 * 그래서 이 모듈은 이전 스냅샷과 지금 스냅샷을 비교해서
 * "경계를 넘은 것"만 골라낸다. 상태 저장은 호출하는 쪽이 한다.
 */

/** 저장해 둘 최소한의 상태. 이것만 있으면 경계를 넘었는지 알 수 있다. */
function snapshot(s) {
  return {
    bornAt: s.bornAtRaw ?? null, // 개체가 바뀌면 진화 알림을 새로 센다
    stage: s.mon ? s.mon.stageIndex : 0,
    graduated: s.dex ? s.dex.graduated : 0,
    codexPercent: s.limits && s.limits.codex ? s.limits.codex.percent : null,
  };
}

/**
 * 보낼 알림 목록.
 *
 * prev가 없으면(앱을 막 켠 상태) 아무것도 보내지 않는다 —
 * 켤 때마다 "진화했습니다"가 뜨면 알림이 아니라 소음이다.
 */
function pending(prev, cur, opts = {}) {
  const out = [];
  if (!prev) return out;

  const warnAt = opts.warnPercent ?? 80;

  // 같은 개체 안에서 단계가 올라갔을 때만 진화로 친다.
  // 새로 뽑으면 단계가 0으로 떨어지는데 그건 진화가 아니다.
  if (prev.bornAt === cur.bornAt && cur.stage > prev.stage) {
    out.push({
      key: "evolve",
      title: cur.stageLabel ? cur.name + " — " + cur.stageLabel : "진화했습니다",
      body: cur.body || "",
    });
  }

  if (cur.graduated > prev.graduated) {
    out.push({
      key: "graduate",
      title: "🎓 " + (cur.name || "포켓몬") + " 졸업",
      body: "도감에 기록됐습니다. 다음 알은 공짜입니다.",
    });
  }

  // 임계값을 "넘어선 순간"만. 넘은 뒤로는 계속 떠 있어도 다시 알리지 않는다.
  if (
    typeof cur.codexPercent === "number" &&
    typeof prev.codexPercent === "number" &&
    prev.codexPercent < warnAt &&
    cur.codexPercent >= warnAt
  ) {
    out.push({
      key: "limit",
      title: "⚠️ Codex 주간 한도 " + cur.codexPercent + "%",
      body: cur.resetIn ? cur.resetIn + " 뒤 리셋됩니다." : "",
    });
  }

  return out;
}

module.exports = { snapshot, pending };
