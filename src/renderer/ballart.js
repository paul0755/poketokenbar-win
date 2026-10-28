"use strict";
/**
 * 볼 그림 — 몬스터볼 · 슈퍼볼 · 하이퍼볼 · 마스터볼. 던지는 창(ball.html)과 상점 아이콘이 같이 쓴다.
 *
 * 100×100 SVG 하나. 아래 반구는 흰색, 위 반구 색과 무늬만 볼마다 다르다. 무늬는 위 반구로
 * 잘라 그리고(clipPath), 그 위에 둥근 그림자 · 테두리 · 가운데 띠 · 버튼 · 반사광을 덮는다.
 *   몬스터볼  빨강
 *   슈퍼볼    파랑 + 양옆 빨간 날개
 *   하이퍼볼  검정 + 노란 H
 *   마스터볼  보라 + 분홍 혹 둘 + 흰 M
 */
(function () {
  const INK = "#1b1c22";
  const TOP = { poke: "#e3373b", great: "#2f6fd6", ultra: "#2a2a33", master: "#7a3fc2" };
  const DECO = {
    poke: "",
    // 양옆 빨간 날개 — 안쪽 가장자리가 위로 갈수록 바깥으로 휜다
    great: `<path d="M9 47 C8 31 12 18 19 7 L32 4 C25 17 22 31 25 47 Z" fill="#e5383b"/>
            <path d="M91 47 C92 31 88 18 81 7 L68 4 C75 17 78 31 75 47 Z" fill="#e5383b"/>`,
    // 노란 H — 띠에서 위로 뻗어 바깥으로 휘는 두 기둥. 가로획은 버튼 위 띠다
    ultra: `<path d="M19 47 C17 32 20 18 28 6 L38 8 C31 20 30 33 31 47 Z" fill="#ffcb05"/>
            <path d="M81 47 C83 32 80 18 72 6 L62 8 C69 20 70 33 69 47 Z" fill="#ffcb05"/>
            <rect x="19" y="41" width="62" height="6" fill="#ffcb05"/>`,
    // 분홍 혹 둘과 흰 M
    master: `<circle cx="21" cy="29" r="10" fill="#e8559c" stroke="${INK}" stroke-width="2.5"/>
             <circle cx="79" cy="29" r="10" fill="#e8559c" stroke="${INK}" stroke-width="2.5"/>
             <circle cx="18" cy="26" r="3" fill="#fff" opacity=".6"/>
             <circle cx="76" cy="26" r="3" fill="#fff" opacity=".6"/>
             <path d="M38 33 L38 15 L50 26 L62 15 L62 33" stroke="#fff" stroke-width="5.5" stroke-linejoin="round" stroke-linecap="round" fill="none"/>`,
  };

  /** svg 안쪽 — uid 는 한 문서에 여러 개 있을 때 clipPath · 그라데이션 id 가 겹치지 않게 */
  function inner(kind, uid = kind) {
    const k = TOP[kind] ? kind : "poke";
    const c = `bc-${uid}`, s = `bs-${uid}`;
    return `<defs>
        <clipPath id="${c}"><path d="M4 50 A46 46 0 0 1 96 50 Z"/></clipPath>
        <radialGradient id="${s}" cx="34%" cy="28%" r="78%">
          <stop offset="0" stop-color="#fff" stop-opacity=".28"/>
          <stop offset=".55" stop-color="#fff" stop-opacity="0"/>
          <stop offset="1" stop-color="#000" stop-opacity=".28"/>
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill="#f2f3f5"/>
      <path d="M4 50 A46 46 0 0 1 96 50 Z" fill="${TOP[k]}"/>
      <g clip-path="url(#${c})">${DECO[k]}</g>
      <circle cx="50" cy="50" r="46" fill="url(#${s})"/>
      <circle cx="50" cy="50" r="46" fill="none" stroke="${INK}" stroke-width="6"/>
      <rect x="4" y="46" width="92" height="8" fill="${INK}"/>
      <circle cx="50" cy="50" r="13" fill="#f2f3f5" stroke="${INK}" stroke-width="6"/>
      <circle cx="50" cy="50" r="5" fill="#fff" stroke="${INK}" stroke-width="3"/>
      <path d="M20 28 Q28 15 41 12" stroke="#fff" stroke-width="5" stroke-linecap="round" fill="none" opacity=".5"/>`;
  }

  let n = 0;
  /** 상점 아이콘처럼 따로 쓰는 svg 한 장 */
  const svg = (kind, size = 26) =>
    `<svg viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">${inner(kind, kind + ++n)}</svg>`;

  window.ptbBall = { inner, svg };
})();
