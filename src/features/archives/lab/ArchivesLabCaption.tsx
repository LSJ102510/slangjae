import {
  IconChevronLeftSmall,
  IconChevronRightSmall,
} from "@wanteddev/wds-icon";

import type { LabActiveCard } from "@/features/archives/lab/types";

interface ArchivesLabCaptionProps {
  card: LabActiveCard;
  totalCount: number;
  onOpen: () => void;
  onShiftPhoto: (direction: 1 | -1) => void;
}

// 사진 바로 아래, 사진 폭에 맞춰 붙는 캡션 — 전시 라벨처럼 "번호 ── 사진 수" 머리줄, 제목, 날짜와 열기 버튼.
// 원래는 화면 맨 아래 구석에 흐린 큰 번호를 깔았는데, 사진과 떨어져 있어 무엇의 설명인지 약했다.
// 올해 행사만 보여 주는 화면이라 연도는 어디에도 두지 않는다.
// 위치·폭은 Engine이 계산한 사진 영역(captionRect)을 그대로 쓴다 — 카드 비율이 4:5로 고정이라
// 좌우 여백(Gallery.mobileSidePadding)도 사진과 같이 따라온다. 여기서 따로 여백을 두지 않는다.
function ArchivesLabCaption({
  card,
  totalCount,
  onOpen,
  onShiftPhoto,
}: ArchivesLabCaptionProps) {
  const number = String(card.index + 1).padStart(2, "0");
  const total = String(totalCount).padStart(2, "0");
  const { captionRect } = card;

  return (
    <div
      className="pointer-events-none absolute text-white transition-all duration-500 ease-out"
      style={{
        left: captionRect.left,
        top: captionRect.top,
        width: captionRect.width,
      }}
    >
      {/* key로 카드가 바뀔 때마다 등장 애니메이션을 다시 돌린다. mt-5 = 사진과 캡션 사이 간격 */}
      <div className="mt-5" key={card.index}>
        <div className="lab-rise flex items-center gap-3 font-medium text-xs tabular-nums tracking-widest">
          <span>
            {number}
            <span className="text-white/40"> / {total}</span>
          </span>
          <span className="lab-draw h-px flex-1 bg-white/30" />
          {/* PC는 옆으로 밀 수 없어서 사진 수 양옆에 넘기기 버튼을 둔다(Gallery.mobileBreakpoint 768px 기준) */}
          <span className="flex items-center gap-1 text-white/60">
            {card.photoCount > 1 && (
              <button
                aria-label="이전 사진"
                className="pointer-events-auto hidden size-6 items-center justify-center rounded-full text-white/70 hover:bg-white/15 hover:text-white min-[769px]:flex"
                onClick={() => onShiftPhoto(-1)}
                type="button"
              >
                <IconChevronLeftSmall />
              </button>
            )}
            사진 {card.photoIndex + 1}/{card.photoCount}
            {card.photoCount > 1 && (
              <button
                aria-label="다음 사진"
                className="pointer-events-auto hidden size-6 items-center justify-center rounded-full text-white/70 hover:bg-white/15 hover:text-white min-[769px]:flex"
                onClick={() => onShiftPhoto(1)}
                type="button"
              >
                <IconChevronRightSmall />
              </button>
            )}
          </span>
        </div>

        <h2
          className="lab-rise mt-3 line-clamp-2 text-balance font-bold text-xl leading-snug tracking-tight"
          style={{ animationDelay: "60ms" }}
        >
          {card.label.word}
        </h2>

        <div
          className="lab-rise mt-3 flex items-center justify-between gap-3"
          style={{ animationDelay: "120ms" }}
        >
          <p className="text-sm text-white/60 tabular-nums">
            {card.label.date}
          </p>
          <button
            className="pointer-events-auto flex h-8 shrink-0 items-center gap-0.5 rounded-full border border-white/20 bg-white/10 pr-2 pl-3 font-semibold text-xs backdrop-blur-md hover:bg-white/20 active:bg-white/20"
            onClick={onOpen}
            type="button"
          >
            앨범 열기
            <IconChevronRightSmall />
          </button>
        </div>
      </div>
    </div>
  );
}

export default ArchivesLabCaption;
