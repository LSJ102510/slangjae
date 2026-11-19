import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  createEventStar,
  type EventStarLayout,
} from "@/features/archives/lab/constellation/constellationLayout";

interface ArchivesLabEventStarProps {
  index: number;
  /** 이 행사 구역을 보고 있는지 — 보고 있을 때만 초록 선이 오간다 */
  isActive: boolean;
}

// 초록 선이 한 번 그어졌다 사라지는 주기(lab.css lab-star-pulse와 같다)
const PULSE_MS = 1700;
// 끝 점 몇 개는 파랗게 — 참고 화면처럼 흰 점 사이에 섞는다
const BLUE_TIP_EVERY = 6;

// 가닥마다 흔들리는 폭(도)·빠르기(초)·시작 위치를 다르게 — 같은 행사는 늘 같은 흔들림이다
export function swayStyle(
  index: number,
  spokeIndex: number,
  hub: { x: number; y: number },
): CSSProperties {
  const random = (salt: number) => {
    const value =
      Math.sin((index + 7) * 91.3 + (spokeIndex + 1) * salt) * 43758.5453;
    return value - Math.floor(value);
  };
  return {
    "--lab-sway": `${2.5 + random(12.9) * 4.5}deg`,
    animationDelay: `${-random(78.2) * 3}s`,
    animationDuration: `${0.9 + random(37.7) * 1.3}s`,
    transformOrigin: `${hub.x}px ${hub.y}px`,
  } as CSSProperties;
}

// 행사 구역 제목 옆의 별 하나. 참고: Shopify Editions Fall '26 카테고리 구역.
// 화면에 들어오면 허브에서 선이 뻗어 나가며 그려지고, 보고 있는 동안은 허브에서 끝 점 한두 개로
// 초록 선이 그어지고 끝에 빈 원이 생겼다 사라지기를 되풀이한다(가리키는 끝 점이 매번 바뀐다).
function ArchivesLabEventStar({ index, isActive }: ArchivesLabEventStarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<EventStarLayout | null>(null);
  const [isDrawn, setIsDrawn] = useState(false);
  const [pulse, setPulse] = useState<{ key: number; tips: number[] } | null>(
    null,
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setLayout((previous) =>
        previous?.width === width && previous.height === height
          ? previous
          : createEventStar(index, width, height),
      );
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [index]);

  // 화면에 들어올 때 한 번 그린다
  useEffect(() => {
    const container = containerRef.current;
    if (!container || isDrawn) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsDrawn(true);
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [isDrawn]);

  useEffect(() => {
    const spokeCount = layout?.spokes.length ?? 0;
    if (!isActive || spokeCount === 0) {
      setPulse(null);
      return;
    }
    let key = 0;
    const next = () => {
      key += 1;
      const first = Math.floor(Math.random() * spokeCount);
      const tips =
        Math.random() < 0.6
          ? [first, (first + 1 + Math.floor(Math.random() * 4)) % spokeCount]
          : [first];
      setPulse({ key, tips });
    };
    const startId = window.setTimeout(next, 600);
    const intervalId = window.setInterval(next, PULSE_MS);
    return () => {
      window.clearTimeout(startId);
      window.clearInterval(intervalId);
    };
  }, [isActive, layout?.spokes.length]);

  return (
    <div
      aria-hidden="true"
      className={`absolute inset-0 ${isDrawn ? "lab-star-drawn" : ""}`}
      ref={containerRef}
    >
      {layout && (
        <svg
          className="overflow-visible"
          height={layout.height}
          role="presentation"
          width={layout.width}
        >
          {layout.traces.map(([from, to], traceIndex) => (
            <line
              // biome-ignore lint/suspicious/noArrayIndexKey: 배치에서 정해진 순서 그대로다
              key={traceIndex}
              stroke="white"
              strokeOpacity={0.07}
              strokeWidth={1}
              x1={from.x}
              x2={to.x}
              y1={from.y}
              y2={to.y}
            />
          ))}

          {/* 선 한 가닥마다 허브를 축으로 제각각 빠르게 흔들린다(참고 화면). 초록 선도 그 가닥 안에 그려서 같이 움직인다 */}
          {layout.spokes.map((spoke, spokeIndex) => {
            const isBlue = spokeIndex % BLUE_TIP_EVERY === 3;
            const pulseTip = pulse?.tips.indexOf(spokeIndex) ?? -1;
            return (
              <g
                className="lab-star-sway"
                // biome-ignore lint/suspicious/noArrayIndexKey: 배치에서 정해진 순서 그대로다
                key={spokeIndex}
                style={swayStyle(index, spokeIndex, layout.hub)}
              >
                <line
                  className="lab-star-spoke"
                  pathLength={1}
                  stroke="white"
                  strokeOpacity={0.32}
                  strokeWidth={1}
                  style={{ transitionDelay: `${spokeIndex * 28}ms` }}
                  x1={layout.hub.x}
                  x2={spoke.x}
                  y1={layout.hub.y}
                  y2={spoke.y}
                />
                <circle
                  className="lab-star-tip"
                  cx={spoke.x}
                  cy={spoke.y}
                  fill={isBlue ? "#5b6cff" : "white"}
                  fillOpacity={isBlue ? 1 : 0.75}
                  r={isBlue ? 2.6 : 1.8}
                  style={{ transitionDelay: `${400 + spokeIndex * 28}ms` }}
                />
                {pulse && pulseTip >= 0 && (
                  <g className="lab-star-pulse" key={pulse.key}>
                    <line
                      pathLength={1}
                      stroke="#8df0a8"
                      strokeWidth={1.5}
                      x1={layout.hub.x}
                      x2={spoke.x}
                      y1={layout.hub.y}
                      y2={spoke.y}
                    />
                    <circle
                      cx={spoke.x}
                      cy={spoke.y}
                      fill="none"
                      r={pulseTip === 0 ? 7 : 5}
                      stroke="#8df0a8"
                      strokeWidth={1.4}
                    />
                  </g>
                )}
              </g>
            );
          })}

          <rect
            fill="white"
            fillOpacity={0.7}
            height={9}
            width={9}
            x={layout.hub.x - 4.5}
            y={layout.hub.y - 4.5}
          />
        </svg>
      )}
    </div>
  );
}

export default ArchivesLabEventStar;
