import {
  type PointerEvent,
  type TouchEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import type { LabTimelineItem } from "@/features/archives/lab/types";

interface ArchivesLabTimelineProps {
  items: LabTimelineItem[];
  activeIndex: number;
  onScrub: (index: number) => void;
}

// 오른쪽 가장자리의 세로 타임라인 — 카드마다 눈금, 연도가 바뀌는 자리에 연도 글자.
// 위아래로 끌면 그 카드로 바로 간다(깊이 스크롤로 한 장씩 넘기기엔 먼 과거로 갈 때).
// 연도 글자는 사진과 겹쳐서, 카드를 넘기거나 끄는 동안만 잠깐 보였다가 사라진다(사진 앱 스크러버처럼).
const YEAR_LABEL_HIDE_DELAY = 1200;
function ArchivesLabTimeline({
  items,
  activeIndex,
  onScrub,
}: ArchivesLabTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const activeYear = items[activeIndex]?.year;
  const [isDragging, setIsDragging] = useState(false);
  const [isRecentlyMoved, setIsRecentlyMoved] = useState(false);
  const isShowingYears = isDragging || isRecentlyMoved;

  // 활성 카드가 바뀔 때마다 연도 글자를 잠깐 띄운다
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeIndex가 바뀌는 순간에만 다시 띄운다
  useEffect(() => {
    setIsRecentlyMoved(true);
    const timeoutId = window.setTimeout(
      () => setIsRecentlyMoved(false),
      YEAR_LABEL_HIDE_DELAY,
    );
    return () => window.clearTimeout(timeoutId);
  }, [activeIndex]);

  function scrubTo(clientY: number) {
    const track = trackRef.current;
    if (!track || items.length < 2) {
      return;
    }
    const { top, height } = track.getBoundingClientRect();
    const ratio = Math.min(Math.max((clientY - top) / height, 0), 1);
    onScrub(Math.round(ratio * (items.length - 1)));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    isDraggingRef.current = true;
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubTo(event.clientY);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (isDraggingRef.current) {
      scrubTo(event.clientY);
    }
  }

  function handlePointerUp() {
    isDraggingRef.current = false;
    setIsDragging(false);
  }

  // 갤러리(Scroll.js)는 window의 touchmove로 깊이 스크롤을 한다 — 여기서 끄는 손가락은 거기까지 가지 않게 막는다
  function stopTouch(event: TouchEvent<HTMLDivElement>) {
    event.stopPropagation();
  }

  return (
    <div
      className="pointer-events-auto absolute top-1/2 right-0 flex h-2/5 -translate-y-1/2 touch-none py-2 pr-3 pl-10"
      onPointerCancel={handlePointerUp}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onTouchMove={stopTouch}
      onTouchStart={stopTouch}
    >
      <div
        className="relative flex flex-col items-end justify-between"
        ref={trackRef}
      >
        {items.map((item, index) => {
          const isActive = index === activeIndex;
          return (
            <div
              className="relative flex h-0 items-center"
              // biome-ignore lint/suspicious/noArrayIndexKey: 카드 순서가 바뀌지 않는 고정 목록이다
              key={index}
            >
              {item.isYearStart && (
                <span
                  className={`absolute right-4 rounded-full bg-black/40 px-1.5 py-0.5 font-semibold text-xs tabular-nums backdrop-blur-sm transition-all duration-300 ${
                    item.year === activeYear ? "text-white" : "text-white/45"
                  } ${isShowingYears ? "opacity-100" : "translate-x-1 opacity-0"}`}
                >
                  {item.year}
                </span>
              )}
              <span
                className={`block w-0.5 rounded-full transition-all duration-300 ${
                  isActive ? "h-4 bg-white" : "h-1 bg-white/40"
                }`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ArchivesLabTimeline;
