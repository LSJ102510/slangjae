// 별자리 배치. 참고: Shopify Editions Fall '26 — 첫 화면의 어두운 판에 카테고리 별자리가 모여 있고,
// 아래 카테고리 구역마다 그 카테고리의 별 하나가 제목 옆에 따로 그려진다.
// 같은 행사는 늘 같은 모양이 되게 index로 만든 의사 난수를 쓴다.
function seeded(index: number, salt: number) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

export interface Point {
  x: number;
  y: number;
}

export interface ConstellationHub extends Point {
  spokes: Point[];
}

// ── 첫 화면 별자리 ──────────────────────────────────────────────

// 폰(세로) 기준 세 줄 기둥으로 엇갈려 내려가는 허브 자리(판 안 0~1 비율). 가로 화면에서는 x·y를 바꾼다
const OVERVIEW_HUB_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.05],
  [0.17, 0.14],
  [0.83, 0.14],
  [0.3, 0.37],
  [0.72, 0.37],
  [0.17, 0.62],
  [0.5, 0.7],
  [0.83, 0.62],
  [0.17, 0.9],
  [0.5, 0.96],
  [0.83, 0.9],
  [0.5, 0.45],
];
// 허브 하나에서 뻗는 선 수 — 사진 수를 따르되 범위 안에 둔다
const OVERVIEW_MIN_SPOKES = 10;
const OVERVIEW_MAX_SPOKES = 36;
const CROSS_LINK_COUNT = 34;

export interface OverviewLayout {
  width: number;
  height: number;
  /** 모든 허브가 이어지는 가운데 작은 원 */
  center: Point;
  hubs: ConstellationHub[];
  crossLinks: [Point, Point][];
}

export function createOverviewLayout(
  width: number,
  height: number,
  photoCounts: number[],
): OverviewLayout {
  const isPortrait = width <= height;
  const short = Math.min(width, height);
  // 허브 아래 이름과 선 끝이 판 밖으로 나가지 않게 띄운다
  const padX = Math.max(width * 0.12, 40);
  const padY = Math.max(height * 0.08, 48);

  const hubs = photoCounts.map((photoCount, index) => {
    const [px, py] =
      OVERVIEW_HUB_POSITIONS[index % OVERVIEW_HUB_POSITIONS.length];
    const [nx, ny] = isPortrait ? [px, py] : [py, px];
    const x = padX + nx * (width - padX * 2);
    const y = padY + ny * (height - padY * 2);
    const count = Math.min(
      Math.max(photoCount, OVERVIEW_MIN_SPOKES),
      OVERVIEW_MAX_SPOKES,
    );
    const spokes = Array.from({ length: count }, (_, spokeIndex) => {
      const angle = seeded(index, spokeIndex + 2) * Math.PI * 2;
      // 짧은 선이 많고 긴 선이 드문드문 — 별처럼 보이게 짧은 쪽으로 몬다
      const length =
        short * (0.035 + seeded(index, spokeIndex + 60) ** 1.6 * 0.17);
      return {
        x: x + Math.cos(angle) * length,
        y: y + Math.sin(angle) * length,
      };
    });
    return { spokes, x, y };
  });

  const center = hubs.length
    ? {
        x: hubs.reduce((sum, hub) => sum + hub.x, 0) / hubs.length,
        y: hubs.reduce((sum, hub) => sum + hub.y, 0) / hubs.length,
      }
    : { x: width / 2, y: height / 2 };

  const crossLinks: [Point, Point][] = [];
  if (hubs.length > 1) {
    for (let link = 0; link < CROSS_LINK_COUNT; link += 1) {
      const from = hubs[Math.floor(seeded(link, 101) * hubs.length)];
      const to = hubs[Math.floor(seeded(link, 202) * hubs.length)];
      if (from !== to) {
        crossLinks.push([
          from.spokes[Math.floor(seeded(link, 303) * from.spokes.length)],
          to.spokes[Math.floor(seeded(link, 404) * to.spokes.length)],
        ]);
      }
    }
  }

  return { center, crossLinks, height, hubs, width };
}

// ── 행사 구역의 별 하나 ──────────────────────────────────────────

const EVENT_SPOKE_COUNT = 22;
// 별 뒤에 아주 흐리게 깔리는 긴 선 — 다른 별자리의 흔적
const EVENT_TRACE_COUNT = 14;

export interface EventStarLayout {
  width: number;
  height: number;
  hub: Point;
  spokes: Point[];
  traces: [Point, Point][];
}

// 참고 화면처럼 허브는 가운데보다 조금 오른쪽, 제목 높이에 두고 가는 선이 사방으로 길게 뻗는다
export function createEventStar(
  index: number,
  width: number,
  height: number,
): EventStarLayout {
  const hub = { x: width * 0.6, y: height * 0.52 };
  const reach = Math.min(width, height);
  const spokes = Array.from({ length: EVENT_SPOKE_COUNT }, (_, spokeIndex) => {
    const angle = seeded(index + 50, spokeIndex + 2) * Math.PI * 2;
    const length = reach * (0.18 + seeded(index + 50, spokeIndex + 40) * 0.42);
    return {
      x: hub.x + Math.cos(angle) * length,
      y: hub.y + Math.sin(angle) * length,
    };
  });
  const traces: [Point, Point][] = Array.from(
    { length: EVENT_TRACE_COUNT },
    (_, traceIndex) => [
      {
        x: seeded(index + 90, traceIndex) * width,
        y: seeded(index + 91, traceIndex) * height,
      },
      {
        x: seeded(index + 92, traceIndex) * width,
        y: seeded(index + 93, traceIndex) * height,
      },
    ],
  );
  return { height, hub, spokes, traces, width };
}
