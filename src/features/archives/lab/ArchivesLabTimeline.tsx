import { type PointerEvent, type TouchEvent, useRef } from "react";

interface ArchivesLabTimelineProps {
  count: number;
  activeIndex: number;
  onScrub: (index: number) => void;
}

// 오른쪽 가장자리의 세로 타임라인 — 카드마다 눈금 하나(목차처럼 지금 몇 번째인지 보인다).
// 위아래로 끌면 그 카드로 바로 간다(깊이 스크롤로 한 장씩 넘기기엔 멀리 갈 때).
// 올해 행사만 보여 주는 화면이라 연도 글자는 두지 않는다.
function ArchivesLabTimeline({
  count,
  activeIndex,
  onScrub,
}: ArchivesLabTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  function scrubTo(clientY: number) {
    const track = trackRef.current;
    if (!track || count < 2) {
      return;
    }
    const { top, height } = track.getBoundingClientRect();
    const ratio = Math.min(Math.max((clientY - top) / height, 0), 1);
    onScrub(Math.round(ratio * (count - 1)));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    isDraggingRef.current = true;
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
        {Array.from({ length: count }, (_, index) => {
          const isActive = index === activeIndex;
          return (
            <div
              className="relative flex h-0 items-center"
              // biome-ignore lint/suspicious/noArrayIndexKey: 카드 순서가 바뀌지 않는 고정 목록이다
              key={index}
            >
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
