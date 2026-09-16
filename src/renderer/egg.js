"use strict";
/**
 * 알 그림.
 *
 * 이모지(🥚)를 키워 쓰고 있었는데 흐릿하고 포켓몬 느낌도 안 났다.
 * PokéAPI에는 쓸 만한 알 스프라이트가 없다 —
 *   pokemon/0.png 는 "?" 플레이스홀더,
 *   items/mystery-egg.png 는 30x30이라 112px로 키우면 뭉갠다.
 * 그래서 SVG로 그린다. 어떤 크기에서도 선명하고 색도 테마에 맞출 수 있다.
 *
 * 쓰는 쪽: <div>${eggSvg(112)}</div>
 */
window.eggSvg = function eggSvg(size = 112) {
  return `
<svg viewBox="0 0 100 104" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" class="eggsvg">
  <defs>
    <radialGradient id="eggBody" cx="38%" cy="30%" r="78%">
      <stop offset="0%" stop-color="#fffaf0"/>
      <stop offset="62%" stop-color="#f3e6cd"/>
      <stop offset="100%" stop-color="#d9c8a8"/>
    </radialGradient>
    <!-- 무늬가 알 밖으로 새지 않게 잘라낸다 -->
    <clipPath id="eggClip">
      <path d="M50 4 C71 4 91 33 91 58 C91 82 72 99 50 99 C28 99 9 82 9 58 C9 33 29 4 50 4 Z"/>
    </clipPath>
  </defs>

  <ellipse cx="50" cy="99" rx="26" ry="4" fill="rgba(0,0,0,.28)"/>

  <path d="M50 4 C71 4 91 33 91 58 C91 82 72 99 50 99 C28 99 9 82 9 58 C9 33 29 4 50 4 Z"
        fill="url(#eggBody)" stroke="#b9a684" stroke-width="2"/>

  <g clip-path="url(#eggClip)" fill="#7ec8a9" opacity=".92">
    <ellipse cx="30" cy="46" rx="11" ry="9"/>
    <ellipse cx="62" cy="34" rx="8" ry="6.5"/>
    <ellipse cx="70" cy="62" rx="12" ry="9.5"/>
    <ellipse cx="42" cy="74" rx="9" ry="7.5"/>
    <ellipse cx="18" cy="70" rx="7" ry="6"/>
  </g>

  <!-- 광택. 있으면 평평한 타원이 아니라 알로 보인다 -->
  <ellipse cx="36" cy="28" rx="9" ry="13" fill="#fff" opacity=".5" transform="rotate(-20 36 28)"/>
</svg>`;
};
