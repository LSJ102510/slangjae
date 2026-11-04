import type { CSSProperties } from "react";

// 진입 화면 배경 — 이번 행사 포스터(슬랑제: 울림)의 배경을 옮겼다. 짙은 파랑 바탕에 큰 원 두 개가
// 은은하게 겹치고, 오른쪽 위와 왼쪽 가운데에 가는 동심원이 퍼진다.
// 포스터(3:4)를 그대로 깔면 폰(약 9:19.5)에서 좌우가 잘려 링이 사라지므로, 요소마다 화면 폭 기준(%)으로
// 따로 배치한다 — width의 %는 부모 폭 기준이라 aspect-square와 함께 쓰면 폭에 맞춘 원이 된다.
// -z-10: 진입 화면(fixed z-20)이 쌓임 맥락을 만들어서, 그 안에서 글자·버튼 뒤로만 깔린다.
// 색은 포스터에서 뽑은 값이고 이 실험 화면에만 쓰여서 토큰으로 올리지 않는다.
export const LAB_INTRO_TOP_COLOR = "#1d3c8f";

const BACKGROUND_STYLE: CSSProperties = {
  backgroundImage: `linear-gradient(165deg, ${LAB_INTRO_TOP_COLOR} 0%, #17348a 45%, #0c2774 100%)`,
};

interface RingsProps {
  /** 원 중심 위치(부모 기준 %) */
  centerX: string;
  centerY: string;
  /** 가장 바깥 링 지름 — 부모 폭 대비 % */
  size: string;
  /** 가장 안쪽 링 반지름(가장 바깥을 1로 본 비율) */
  innerRatio: number;
  count: number;
}

// 가는 흰 동심원 묶음. 선 굵기는 크기와 상관없이 1px로 둔다(vector-effect).
function Rings({ centerX, centerY, size, innerRatio, count }: RingsProps) {
  const radii = Array.from(
    { length: count },
    (_, index) =>
      100 * (innerRatio + ((1 - innerRatio) * index) / Math.max(count - 1, 1)),
  );

  return (
    <svg
      aria-hidden="true"
      className="absolute aspect-square -translate-x-1/2 -translate-y-1/2 overflow-visible"
      style={{ left: centerX, top: centerY, width: size }}
      viewBox="-100 -100 200 200"
    >
      {radii.map((radius) => (
        <circle
          cx={0}
          cy={0}
          fill="none"
          key={radius}
          r={radius}
          stroke="white"
          strokeOpacity={0.28}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function ArchivesLabIntroBackground() {
  return (
    <div
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      style={BACKGROUND_STYLE}
    >
      {/* 큰 원 — 왼쪽 위를 덮는 원과 오른쪽 아래에서 살짝 들어오는 원 */}
      <div
        className="absolute aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/5"
        style={{ left: "22%", top: "30%", width: "150%" }}
      />
      <div
        className="absolute aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/5"
        style={{ left: "118%", top: "80%", width: "70%" }}
      />

      <Rings
        centerX="108%"
        centerY="4%"
        count={18}
        innerRatio={0.3}
        size="75%"
      />
      <Rings
        centerX="-8%"
        centerY="88%"
        count={20}
        innerRatio={0.76}
        size="210%"
      />
    </div>
  );
}

export default ArchivesLabIntroBackground;
