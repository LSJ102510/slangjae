import { IconChevronLeft } from "@wanteddev/wds-icon";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { fetchArchive } from "@/entities/archives/archivesApi";
import type { ArchiveDetail } from "@/entities/archives/types";
import ArchivesLabEventStar from "@/features/archives/lab/constellation/ArchivesLabEventStar";
import {
  createOverviewLayout,
  type OverviewLayout,
} from "@/features/archives/lab/constellation/constellationLayout";

export interface ConstellationEvent {
  archiveId: string;
  title: string;
  date: string;
  photos: string[];
}

interface ArchivesLabConstellationProps {
  events: ConstellationEvent[];
  /** 열릴 때 — 아래에서 올라오거나(slide) 그 자리에서 나타난다(fade) */
  entrance: "slide" | "fade";
  /** 앨범에서 돌아왔거나 #event-n으로 들어왔을 때 — 그 행사 구역에서 바로 시작한다 */
  initialIndex: number | null;
  onClose: () => void;
  onRestart: () => void;
  onOpenAlbum: (eventIndex: number, archiveId: string) => void;
}

// 첫 화면은 진입 화면과 같은 포스터 파랑이고, 행사 구역마다 배경색이 바뀐다(참고 화면의 카테고리 색).
// 이웃 행사끼리 비슷해 보이지 않게 색조가 다른 열 가지를 쓰고, 맺음 화면은 따로 깊은 남색이다
const POSTER_COLOR = "#17348a";
const OUTRO_COLOR = "#0b1033";
const EVENT_COLORS = [
  "#a3410f",
  "#1d5a48",
  "#5b2b80",
  "#2a6fd6",
  "#8c2340",
  "#0f6470",
  "#86600c",
  "#a8306a",
  "#4a6b1a",
  "#3a3f52",
];
// 별자리 첫 화면에서 행사마다 그 행사 구역의 배경색으로 별을 칠한다. 원래 색은 포스터 파랑 위에서
// 어두워 묻혀서 흰색 쪽으로 밝혀 쓴다
function lighten(hex: string, amount: number) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) =>
    Math.round(
      ((value >> shift) & 255) + (255 - ((value >> shift) & 255)) * amount,
    );
  return `rgb(${channel(16)} ${channel(8)} ${channel(0)})`;
}

// 불꽃 — 아무 때나 아무 행사에서 터진다. 0.4~1.2초마다 행사 1~3개를 골라 터뜨린다
const BURST_MIN_GAP_MS = 400;
const BURST_MAX_GAP_MS = 1200;
const BURST_MAX_COUNT = 3;

// 별 끝 점마다 반짝이는 빠르기(2.4~5초)와 시작 때를 흩어서 한꺼번에 깜빡이지 않게 한다
function twinkleStyle(hubIndex: number, spokeIndex: number): CSSProperties {
  const random = (salt: number) => {
    const value =
      Math.sin((hubIndex + 3) * 57.1 + (spokeIndex + 1) * salt) * 43758.5453;
    return value - Math.floor(value);
  };
  return {
    animationDelay: `${(-random(19.7) * 5).toFixed(2)}s`,
    animationDuration: `${(2.4 + random(83.3) * 2.6).toFixed(2)}s`,
  };
}

const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, monospace";

// 허브 아래 이름이 옆 허브와 겹치지 않게 짧게 자른다
function shortTitle(title: string) {
  return title.length > 11 ? `${title.slice(0, 10)}…` : title;
}

// 별자리 화면 — 갤러리 끝 화면(환영 문구) 다음에 올해 행사를 모아 보여 준다. 참고: Shopify Editions Fall '26.
// 첫 화면은 어두운 판에 행사 별자리가 모여 있고 스크롤하면 그대로 위로 지나간다. 그 아래로 행사 구역이
// 이어지며, 구역마다 그 행사의 별 하나(ArchivesLabEventStar)와 큰 제목, 소개 상자가 있다.
function ArchivesLabConstellation({
  events,
  entrance,
  initialIndex,
  onClose,
  onRestart,
  onOpenAlbum,
}: ArchivesLabConstellationProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);
  const outroRef = useRef<HTMLElement>(null);
  const frameRef = useRef<number | null>(null);
  const [panelSize, setPanelSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  // 행사(허브)마다 지금 터지는 불꽃의 번호 — 바뀔 때마다 불꽃 요소를 새로 그려 애니메이션을 다시 돌린다
  const [bursts, setBursts] = useState<Record<number, number>>({});
  const [isOutro, setIsOutro] = useState(false);
  const [details, setDetails] = useState<Record<string, ArchiveDetail | null>>(
    {},
  );

  const overview: OverviewLayout | null = useMemo(
    () =>
      panelSize
        ? createOverviewLayout(
            panelSize.width,
            panelSize.height,
            events.map((event) => event.photos.length),
          )
        : null,
    [panelSize, events],
  );

  useEffect(() => {
    let cancelled = false;
    const ids = [...new Set(events.map((event) => event.archiveId))];
    Promise.all(ids.map((id) => fetchArchive(id).then((d) => [id, d] as const)))
      .then((entries) => {
        if (!cancelled) {
          setDetails(Object.fromEntries(entries));
        }
      })
      .catch((error: unknown) => {
        console.error("행사 상세를 받지 못했어요.", error);
      });
    return () => {
      cancelled = true;
    };
  }, [events]);

  const hubCount = overview?.hubs.length ?? 0;
  useEffect(() => {
    if (
      hubCount === 0 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    let burstId = 0;
    let timeoutId = 0;
    const fire = () => {
      const count = 1 + Math.floor(Math.random() * BURST_MAX_COUNT);
      setBursts((previous) => {
        const next = { ...previous };
        for (let k = 0; k < count; k += 1) {
          burstId += 1;
          next[Math.floor(Math.random() * hubCount)] = burstId;
        }
        return next;
      });
      timeoutId = window.setTimeout(
        fire,
        BURST_MIN_GAP_MS +
          Math.random() * (BURST_MAX_GAP_MS - BURST_MIN_GAP_MS),
      );
    };
    timeoutId = window.setTimeout(fire, BURST_MIN_GAP_MS);
    return () => window.clearTimeout(timeoutId);
  }, [hubCount]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setPanelSize((previous) =>
        previous?.width === width && previous.height === height
          ? previous
          : { height, width },
      );
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  // 화면 가운데를 지나고 있는 행사 구역 — 배경색·번호·목차와 별의 초록 선을 정한다
  const updateActive = useCallback(() => {
    frameRef.current = null;
    const scroller = scrollRef.current;
    if (!scroller) {
      return;
    }
    const line = scroller.scrollTop + scroller.clientHeight * 0.5;
    const outroTop = outroRef.current?.offsetTop ?? Number.POSITIVE_INFINITY;
    let next = -1;
    setIsOutro(line >= outroTop);
    if (line < outroTop) {
      sectionRefs.current.forEach((section, index) => {
        if (section && section.offsetTop <= line) {
          next = index;
        }
      });
    }
    setActiveIndex(next);
  }, []);

  function handleScroll() {
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(updateActive);
    }
  }

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    },
    [],
  );

  // 참고 화면의 목차 링크처럼 그 행사 구역으로 곧장 옮긴다. 주소 끝에 #event-n을 남겨서
  // 그 주소로 들어오면 이 행사에서 시작한다(ArchivesLabScreen)
  const jumpToEvent = useCallback(
    (index: number) => {
      const scroller = scrollRef.current;
      const section = sectionRefs.current[index];
      if (!scroller || !section) {
        return;
      }
      scroller.scrollTop = section.offsetTop;
      window.history.replaceState(
        window.history.state,
        "",
        `#event-${index + 1}`,
      );
      updateActive();
    },
    [updateActive],
  );

  // 앨범에서 돌아왔거나 #event-n으로 들어왔으면, 상자 높이가 정해진 뒤(상세를 받은 뒤) 그 행사로 간다
  const hasRestoredRef = useRef(false);
  useLayoutEffect(() => {
    if (
      hasRestoredRef.current ||
      initialIndex === null ||
      Object.keys(details).length === 0
    ) {
      return;
    }
    hasRestoredRef.current = true;
    const section = sectionRefs.current[initialIndex];
    if (scrollRef.current && section) {
      scrollRef.current.scrollTop = section.offsetTop;
      updateActive();
    }
  }, [details, initialIndex, updateActive]);

  const isInEvent = activeIndex >= 0;

  // 뒤로가기 — 행사 구역이나 맺음 화면을 보고 있으면 먼저 첫 화면(올해의 울림)으로 올라가고,
  // 첫 화면에서 누르면 별자리를 닫는다
  function handleBack() {
    const scroller = scrollRef.current;
    if (scroller && scroller.scrollTop > 0) {
      scroller.scrollTo({ behavior: "smooth", top: 0 });
      if (window.location.hash) {
        window.history.replaceState(
          window.history.state,
          "",
          window.location.pathname + window.location.search,
        );
      }
      return;
    }
    onClose();
  }

  return (
    <div
      className={`${entrance === "fade" ? "lab-fade-in" : "lab-slide-up"} fixed inset-0 z-[25] overflow-hidden text-white transition-colors duration-700`}
      style={{
        backgroundColor: isInEvent
          ? EVENT_COLORS[activeIndex % EVENT_COLORS.length]
          : isOutro
            ? OUTRO_COLOR
            : POSTER_COLOR,
      }}
    >
      <div
        className="scrollbar-hidden absolute inset-0 overflow-y-auto overscroll-contain"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        {/* 첫 화면 — 제목 아래 포스터 파랑 위에 행사 별자리 — 행사마다 그 행사 구역의 색으로 칠한다. 허브를 누르면 그 행사로 간다 */}
        <section className="flex h-svh flex-col px-4 pt-safe-top pb-4">
          <div className="px-2 pt-16 pb-5 text-center">
            <h2 className="font-bold text-[52px] leading-none tracking-tight min-[769px]:text-7xl">
              올해의 울림
            </h2>
            {/* 참고 화면 제목 아래의 고정폭 글자 한 줄처럼 — 이번 학생회 임기 */}
            <p className="mt-3 font-mono text-sm text-white/80 tracking-wide">
              2025.11 ~ 2026.11
            </p>
          </div>
          <div
            className="relative min-h-0 flex-1 overflow-hidden"
            ref={panelRef}
          >
            {overview && (
              <>
                <svg
                  aria-hidden="true"
                  className="absolute inset-0"
                  height={overview.height}
                  role="presentation"
                  width={overview.width}
                >
                  {overview.crossLinks.map(([from, to], linkIndex) => (
                    <line
                      // biome-ignore lint/suspicious/noArrayIndexKey: 배치에서 정해진 순서 그대로다
                      key={linkIndex}
                      stroke="white"
                      strokeOpacity={0.1}
                      strokeWidth={0.6}
                      x1={from.x}
                      x2={to.x}
                      y1={from.y}
                      y2={to.y}
                    />
                  ))}
                  {overview.hubs.map((hub, index) => (
                    <line
                      // biome-ignore lint/suspicious/noArrayIndexKey: 허브는 행사 순서 그대로이고 바뀌지 않는다
                      key={index}
                      stroke="white"
                      strokeOpacity={0.22}
                      strokeWidth={1}
                      x1={overview.center.x}
                      x2={hub.x}
                      y1={overview.center.y}
                      y2={hub.y}
                    />
                  ))}
                  <circle
                    cx={overview.center.x}
                    cy={overview.center.y}
                    fill="none"
                    r={5}
                    stroke="white"
                    strokeWidth={1.2}
                  />
                  {overview.hubs.map((hub, index) => {
                    const color = lighten(
                      EVENT_COLORS[index % EVENT_COLORS.length],
                      0.45,
                    );
                    return (
                      <g
                        className="lab-star-drift"
                        // biome-ignore lint/suspicious/noArrayIndexKey: 허브는 행사 순서 그대로이고 바뀌지 않는다
                        key={index}
                        style={{
                          animationDelay: `${-index * 1.7}s`,
                          transformOrigin: `${hub.x}px ${hub.y}px`,
                        }}
                      >
                        {/* 평소엔 별 끝 점이 제각각 천천히 반짝이고, 1.5초마다 행사 하나씩 돌아가며 불꽃처럼
                            터진다 — 허브에서 빛줄기가 끝 점까지 날아가고 끝 점이 반짝 커졌다 살짝 떨어진다 */}
                        {hub.spokes.map((spoke, spokeIndex) => (
                          <line
                            // biome-ignore lint/suspicious/noArrayIndexKey: 같은 허브의 선 순서는 고정이다
                            key={spokeIndex}
                            stroke={color}
                            strokeOpacity={0.5}
                            strokeWidth={1}
                            x1={hub.x}
                            x2={spoke.x}
                            y1={hub.y}
                            y2={spoke.y}
                          />
                        ))}
                        {hub.spokes.map((spoke, spokeIndex) => (
                          <circle
                            className="lab-twinkle"
                            cx={spoke.x}
                            cy={spoke.y}
                            fill={spokeIndex % 6 === 3 ? "white" : color}
                            // biome-ignore lint/suspicious/noArrayIndexKey: 같은 허브의 별 순서는 고정이다
                            key={spokeIndex}
                            r={spokeIndex % 6 === 3 ? 2.2 : 1.6}
                            style={twinkleStyle(index, spokeIndex)}
                          />
                        ))}
                        {bursts[index] !== undefined && (
                          <g key={bursts[index]}>
                            {hub.spokes.map((spoke, spokeIndex) => (
                              <line
                                className="lab-burst-trail"
                                // biome-ignore lint/suspicious/noArrayIndexKey: 같은 허브의 선 순서는 고정이다
                                key={spokeIndex}
                                pathLength={1}
                                stroke={color}
                                strokeLinecap="round"
                                strokeWidth={1.6}
                                style={{
                                  animationDelay: `${(spokeIndex % 5) * 0.04}s`,
                                }}
                                x1={hub.x}
                                x2={spoke.x}
                                y1={hub.y}
                                y2={spoke.y}
                              />
                            ))}
                            {hub.spokes.map((spoke, spokeIndex) => (
                              <circle
                                className="lab-burst-tip"
                                cx={spoke.x}
                                cy={spoke.y}
                                fill={spokeIndex % 6 === 3 ? "white" : color}
                                // biome-ignore lint/suspicious/noArrayIndexKey: 같은 허브의 별 순서는 고정이다
                                key={spokeIndex}
                                r={spokeIndex % 6 === 3 ? 2.2 : 1.6}
                                style={{
                                  animationDelay: `${(spokeIndex % 5) * 0.04}s`,
                                }}
                              />
                            ))}
                          </g>
                        )}
                      </g>
                    );
                  })}
                  {overview.hubs.map((hub, index) => (
                    <g
                      // biome-ignore lint/suspicious/noArrayIndexKey: 허브는 행사 순서 그대로이고 바뀌지 않는다
                      key={index}
                    >
                      <circle
                        className="lab-hub-glow"
                        cx={hub.x}
                        cy={hub.y}
                        fill={lighten(
                          EVENT_COLORS[index % EVENT_COLORS.length],
                          0.6,
                        )}
                        r={10}
                        style={{ animationDelay: `${-index * 0.9}s` }}
                      />
                      <circle
                        cx={hub.x}
                        cy={hub.y}
                        fill={lighten(
                          EVENT_COLORS[index % EVENT_COLORS.length],
                          0.6,
                        )}
                        r={4.5}
                      />
                      <text
                        fill="white"
                        fontFamily={MONO_FONT}
                        fontSize={12}
                        textAnchor="middle"
                        x={hub.x}
                        y={hub.y + 24}
                      >
                        {shortTitle(events[index].title)}
                      </text>
                    </g>
                  ))}
                </svg>
                {/* 누르는 자리 — 허브와 그 아래 이름을 덮는다 */}
                {overview.hubs.map((hub, index) => (
                  <button
                    aria-label={events[index].title}
                    className="absolute size-16 -translate-x-1/2 -translate-y-1/2"
                    // biome-ignore lint/suspicious/noArrayIndexKey: 허브는 행사 순서 그대로이고 바뀌지 않는다
                    key={index}
                    onClick={() => jumpToEvent(index)}
                    style={{ left: hub.x, top: hub.y + 10 }}
                    type="button"
                  />
                ))}
              </>
            )}
          </div>
        </section>

        {events.map((event, index) => {
          const detail = details[event.archiveId];
          const photos = detail?.photos.length ? detail.photos : event.photos;
          return (
            <section
              // biome-ignore lint/suspicious/noArrayIndexKey: 목데이터는 같은 앨범을 여러 행사가 돌려 써서 id만으로는 겹친다
              key={`${event.archiveId}-${index}`}
              ref={(element) => {
                sectionRefs.current[index] = element;
              }}
            >
              {/* 행사 별 하나와 그 왼편의 큰 제목 */}
              <div className="relative h-[58svh] overflow-hidden">
                <ArchivesLabEventStar
                  index={index}
                  isActive={index === activeIndex}
                />
                {/* PC에서는 별 허브(가로 60% 자리) 바로 왼쪽까지 끌어온다(글은 왼쪽 정렬) — 별을 가리지 않으면서 가운데에 가깝게 */}
                <div className="pointer-events-none absolute top-[52%] left-6 max-w-[66%] -translate-y-1/2 min-[769px]:right-[calc(40%+56px)] min-[769px]:left-auto min-[769px]:max-w-[46%]">
                  <p className="font-mono text-white/60 text-xs tabular-nums">
                    {String(index + 1).padStart(2, "0")} / {events.length} ·{" "}
                    {event.date}
                  </p>
                  <h3 className="mt-2 break-keep font-bold text-[40px] leading-[1.08] tracking-tight">
                    {event.title}
                  </h3>
                </div>
              </div>

              {/* 참고 화면의 기능 상자 — 바탕색이 비치는 옅은 상자에 제목·설명·고정폭 글자 버튼, 사진,
                  그 아래 일시·장소·주관을 가는 선으로 나눈 줄로 단다. PC에서는 가운데에 둔다 */}
              <div className="px-4 pb-24 min-[769px]:mx-auto min-[769px]:max-w-2xl">
                <article className="border border-white/20 bg-white/10">
                  <div className="px-6 pt-7 pb-6">
                    <h4 className="break-keep font-medium text-[17px] leading-snug">
                      {event.title}
                    </h4>
                    {detail?.activity && (
                      <p className="mt-3 whitespace-pre-line break-keep text-[15px] text-white/75 leading-relaxed">
                        {detail.activity}
                      </p>
                    )}
                    <button
                      className="mt-5 rounded-full bg-black/45 px-4 py-2 font-mono text-sm text-white active:bg-black/60"
                      onClick={() => onOpenAlbum(index, event.archiveId)}
                      type="button"
                    >
                      앨범 열기 · {photos.length}장
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 px-6 pb-6">
                    {photos.slice(0, 3).map((photo, photoIndex) => (
                      <img
                        alt=""
                        className={`w-full object-cover ${
                          photoIndex === 0
                            ? "col-span-2 aspect-[4/3]"
                            : "aspect-square"
                        }`}
                        // biome-ignore lint/suspicious/noArrayIndexKey: 같은 사진이 여러 번 들어 있을 수 있다(목데이터)
                        key={photoIndex}
                        loading="lazy"
                        src={photo}
                      />
                    ))}
                  </div>
                  {detail && (
                    <dl className="border-white/20 border-t">
                      {[
                        ["일시", detail.schedule],
                        ["장소", detail.location],
                        ["주관", detail.department],
                      ].map(([label, value]) => (
                        <div
                          className="border-white/20 border-b px-6 py-4 last:border-b-0"
                          key={label}
                        >
                          <dt className="font-mono text-white/55 text-xs">
                            {label}
                          </dt>
                          <dd className="mt-1.5 text-[16px]">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </article>
              </div>
            </section>
          );
        })}

        <section
          className="flex h-svh flex-col px-6 pt-safe-top pb-6 min-[769px]:items-center min-[769px]:text-center"
          ref={outroRef}
        >
          <h2 className="pt-16 font-bold text-3xl leading-tight tracking-tight">
            올해를 함께 울려 줘서
            <br />
            고마워요
          </h2>
          <p className="mt-3 break-keep text-sm text-white/60 leading-relaxed">
            내년의 울림도 함께 만들어요.
          </p>
          <button
            className="mt-auto h-14 rounded-full bg-white font-semibold text-base text-black min-[769px]:w-80"
            onClick={onRestart}
            type="button"
          >
            처음으로
          </button>
          <div className="h-safe-bottom" />
        </section>
      </div>

      {/* 위 — 뒤로가기(handleBack)와 지금 행사 번호 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 pt-safe-top">
        <div className="flex h-14 items-center justify-between px-4">
          <button
            aria-label="뒤로가기"
            className="pointer-events-auto flex size-10 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur-md active:bg-white/20"
            onClick={handleBack}
            type="button"
          >
            <IconChevronLeft />
          </button>
          <p
            className={`font-mono text-white/70 text-xs tabular-nums transition-opacity ${isInEvent ? "opacity-100" : "opacity-0"}`}
          >
            {String(activeIndex + 1).padStart(2, "0")} / {events.length}
          </p>
        </div>
      </div>

      {/* 오른쪽 목차 — 행사 구역에서만. 누르면 그 행사로 간다 */}
      <nav
        aria-label="행사 목차"
        className={`absolute top-1/2 right-1 flex -translate-y-1/2 flex-col transition-opacity ${
          isInEvent ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {events.map((event, index) => (
          <button
            aria-current={index === activeIndex ? "true" : undefined}
            aria-label={event.title}
            className="flex h-7 w-6 items-center justify-center"
            // biome-ignore lint/suspicious/noArrayIndexKey: 목데이터는 같은 앨범을 여러 행사가 돌려 써서 id만으로는 겹친다
            key={`${event.archiveId}-${index}`}
            onClick={() => jumpToEvent(index)}
            type="button"
          >
            <span
              className={`block rounded-full transition-all ${
                index === activeIndex
                  ? "size-2 bg-white"
                  : "size-1.5 bg-white/35"
              }`}
            />
          </button>
        ))}
      </nav>
    </div>
  );
}

export default ArchivesLabConstellation;
