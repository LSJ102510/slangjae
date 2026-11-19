import { IconChevronLeft, IconChevronUpSmall } from "@wanteddev/wds-icon";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { fetchArchive } from "@/entities/archives/archivesApi";
import ArchivesLabCaption from "@/features/archives/lab/ArchivesLabCaption";
import ArchivesLabIntroBackground, {
  LAB_INTRO_TOP_COLOR,
} from "@/features/archives/lab/ArchivesLabIntroBackground";
import ArchivesLabTimeline from "@/features/archives/lab/ArchivesLabTimeline";
import { galleryPlaneData } from "@/features/archives/lab/experience/galleryData.js";
import type { LabActiveCard } from "@/features/archives/lab/types";

// 실험용 화면 — houmahani/codrops-depth-gallery(MIT)의 Experience 코드를 가져와
// 아카이빙 사진으로 돌려본 것이다. Figma에 없는 화면이고 비교용이라 라우트도 임시다(/archives/lab).
// 원본 소스: https://github.com/houmahani/codrops-depth-gallery
// 3D 장면(카드·배경)은 experience/가 그리고, 글자 UI(캡션·타임라인·진입 화면)는 여기서 그린다.
import "@/features/archives/lab/experience/canvas.css";
import "@/features/archives/lab/lab.css";

// Engine.js에서 이 화면이 부르는 것만
interface LabEngine {
  isInitialized: boolean;
  init: (options?: { restorePosition?: LabPosition | null }) => Promise<void>;
  enter: () => void;
  scrollToIndex: (index: number) => void;
  openActive: (target: LabOpenTarget) => void;
  shiftPhoto: (direction: 1 | -1) => void;
  pause: () => void;
  resume: (callbacks: LabEngineCallbacks) => void;
  dispose: () => void;
}

// 사진(카드)을 누르면 행사 상세, "앨범 열기"를 누르면 현장 사진 모아보기(상세의 "현장 사진 더보기"와 같은 화면)
type LabOpenTarget = "detail" | "photos";

interface LabEngineCallbacks {
  onActiveChange: (card: LabActiveCard) => void;
  onOpen: (archiveId: string, target: LabOpenTarget) => void;
  onOpenStart: (archiveId: string) => void;
  onTopColorChange: (hex: string) => void;
  onEndChange: (isAtEnd: boolean) => void;
}

// 엔진이 첫 색을 알려 주기 전 상태표시줄 색 — 캔버스 바탕(bg-black)과 같다
const LAB_INITIAL_TOP_COLOR = "#000000";

function applyTopColor(themeColorMeta: HTMLMetaElement, hex: string) {
  themeColorMeta.content = hex;
  document.documentElement.style.backgroundColor = hex;
}

// 사진·앨범을 열어 상세나 현장 사진 화면으로 갈 때 엔진을 캔버스째 여기 맡겨 두고, 돌아오면 그대로 다시 붙인다.
// 새로 만들면 WebGL 컨텍스트·셰이더·사진 업로드에 시간이 걸려 돌아올 때 검은 화면이 비친다.
// keepAlive가 아닌 정리(뒤로가기로 나감, StrictMode의 마운트→정리→마운트)는 다음 틱에 바로 버린다 —
// StrictMode는 그 사이에 다시 마운트돼서 되찾아 간다.
interface ParkedEngine {
  engine: LabEngine;
  canvas: HTMLCanvasElement;
  keepAlive: boolean;
  disposeTimeoutId: number;
}

// 상세·현장 사진 화면에서 이만큼 안 돌아오면 GPU 자원을 놓아준다
const PARKED_KEEP_ALIVE_MS = 5 * 60 * 1000;

let parkedEngine: ParkedEngine | null = null;

function disposeParkedEngine() {
  if (!parkedEngine) {
    return;
  }
  window.clearTimeout(parkedEngine.disposeTimeoutId);
  parkedEngine.engine.dispose();
  parkedEngine.canvas.remove();
  parkedEngine = null;
}

function parkEngine(
  engine: LabEngine,
  canvas: HTMLCanvasElement,
  keepAlive: boolean,
) {
  disposeParkedEngine();
  engine.pause();
  parkedEngine = {
    canvas,
    disposeTimeoutId: window.setTimeout(
      disposeParkedEngine,
      keepAlive ? PARKED_KEEP_ALIVE_MS : 0,
    ),
    engine,
    keepAlive,
  };
}

// 앨범에서 돌아온 게 아닌데(보던 위치 없음) 앨범용으로 맡겨 둔 엔진이 있으면, 그 위치로 이어 붙이면
// 안 되니 버리고 새로 만든다.
function takeParkedEngine(hasRestorePosition: boolean) {
  const parked = parkedEngine;
  if (!parked) {
    return null;
  }
  if (parked.keepAlive && !hasRestorePosition) {
    disposeParkedEngine();
    return null;
  }
  window.clearTimeout(parked.disposeTimeoutId);
  parkedEngine = null;
  return parked;
}

// 앨범을 열기 전에 보던 카드·사진 — 이 화면의 history 항목(location.state)에 남겨 두고,
// 뒤로 돌아오면 진입 화면 없이 그 자리에서 다시 시작한다.
interface LabPosition {
  index: number;
  photoIndex: number;
}

function isLabPosition(state: unknown): state is LabPosition {
  return (
    typeof state === "object" &&
    state !== null &&
    typeof (state as LabPosition).index === "number" &&
    typeof (state as LabPosition).photoIndex === "number"
  );
}

// 카드가 바뀌는 순간 손끝에 짧게 — 안드로이드만 지원하고 iOS 사파리는 vibrate가 없다
function tick() {
  navigator.vibrate?.(8);
}

function ArchivesLabScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  // 마운트 때의 값만 쓴다 — 열기 직전에 state를 바꿔 써도 엔진을 다시 만들지 않게 ref로 잡아 둔다
  const restoredPositionRef = useRef(
    isLabPosition(location.state) ? location.state : null,
  );
  const pathnameRef = useRef(location.pathname);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<LabEngine | null>(null);
  const isOpeningRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  // 앨범에서 돌아온 경우엔 처음부터 들어간 상태로 둔다 — false로 시작하면 진입 화면이 그려졌다가
  // 사진을 다 받은 뒤에야 사라져서, 돌아올 때마다 진입 화면이 잠깐 비친다.
  const [isEntered, setIsEntered] = useState(
    () => restoredPositionRef.current !== null,
  );
  const [isOpening, setIsOpening] = useState(false);
  const [activeCard, setActiveCard] = useState<LabActiveCard | null>(null);
  // 마지막 카드에서 한 번 더 밀면 끝 화면(환영 문구)이 뜬다
  const [isAtEnd, setIsAtEnd] = useState(false);
  const previousCardRef = useRef<LabActiveCard | null>(null);

  // 폰 브라우저는 상태표시줄 색을 theme-color(Android Chrome)나 html 배경(iOS Safari)에서 가져온다.
  // 둘 다 없으면 흰색이라 화면 위에 흰 띠가 생긴다 — 이 화면에 있는 동안만 배경 셰이더의 위쪽 색을 따라 칠한다.
  // 색은 엔진이 바뀔 때마다 onTopColorChange로 알려 주고, 받기 전(로딩 중)에는 캔버스 바탕과 같은 검정이다.
  // 진입 화면이 떠 있는 동안은 그 배경(포스터 파랑)을 쓰고, 엔진 색은 기억만 해 뒀다가 들어가면 칠한다.
  // 매번 state로 두면 색이 바뀔 때마다 화면 전체가 다시 렌더링되므로 DOM에 바로 쓴다.
  const themeColorMetaRef = useRef<HTMLMetaElement | null>(null);
  const engineTopColorRef = useRef(LAB_INITIAL_TOP_COLOR);
  const isEnteredRef = useRef(isEntered);
  const isAtEndRef = useRef(isAtEnd);

  useEffect(() => {
    const root = document.documentElement;
    const previousRootBackground = root.style.backgroundColor;
    const existingMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    const previousThemeColor = existingMeta?.content ?? null;
    const themeColorMeta = existingMeta ?? document.createElement("meta");
    if (!existingMeta) {
      themeColorMeta.name = "theme-color";
      document.head.append(themeColorMeta);
    }
    themeColorMetaRef.current = themeColorMeta;

    return () => {
      themeColorMetaRef.current = null;
      root.style.backgroundColor = previousRootBackground;
      if (previousThemeColor === null) {
        themeColorMeta.remove();
      } else {
        themeColorMeta.content = previousThemeColor;
      }
    };
  }, []);

  // 끝 화면도 진입 화면과 같은 포스터 배경이라 같은 색을 쓴다
  useEffect(() => {
    isEnteredRef.current = isEntered;
    isAtEndRef.current = isAtEnd;
    if (themeColorMetaRef.current) {
      applyTopColor(
        themeColorMetaRef.current,
        isEntered && !isAtEnd ? engineTopColorRef.current : LAB_INTRO_TOP_COLOR,
      );
    }
  }, [isEntered, isAtEnd]);

  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) {
      return;
    }

    const callbacks: LabEngineCallbacks = {
      onActiveChange: (card) => {
        const previous = previousCardRef.current;
        if (
          previous &&
          (previous.index !== card.index ||
            previous.photoIndex !== card.photoIndex)
        ) {
          tick();
        }
        previousCardRef.current = card;
        setActiveCard(card);
      },
      onOpen: (archiveId, target) => {
        const current = previousCardRef.current;
        if (current) {
          const position: LabPosition = {
            index: current.index,
            photoIndex: current.photoIndex,
          };
          navigate(pathnameRef.current, { replace: true, state: position });
        }
        navigate(
          target === "photos"
            ? `/archives/${archiveId}/photos`
            : `/archives/${archiveId}`,
        );
      },
      onTopColorChange: (hex) => {
        engineTopColorRef.current = hex;
        if (
          isEnteredRef.current &&
          !isAtEndRef.current &&
          themeColorMetaRef.current
        ) {
          applyTopColor(themeColorMetaRef.current, hex);
        }
      },
      onEndChange: (nextIsAtEnd) => {
        setIsAtEnd(nextIsAtEnd);
      },
      onOpenStart: (archiveId) => {
        isOpeningRef.current = true;
        setIsOpening(true);
        // 카드 속으로 들어가는 연출(0.52초) 동안 앨범 데이터를 미리 요청해 둔다 — 같은 요청은 캐시돼서
        // 상세·현장 사진 화면이 이 응답을 그대로 받아 스켈레톤 없이 바로 그려진다.
        fetchArchive(archiveId);
      },
    };

    let disposed = false;
    let engine: LabEngine | null = null;
    let canvas: HTMLCanvasElement;

    const parked = takeParkedEngine(restoredPositionRef.current !== null);
    if (parked) {
      // 앨범에서 돌아옴 — 멈춰 둔 장면을 그대로 다시 붙인다(보던 카드·사진도 엔진이 들고 있다)
      canvas = parked.canvas;
      container.append(canvas);
      engine = parked.engine;
      engineRef.current = engine;
      engine.resume(callbacks);
      setIsReady(true);
    } else {
      canvas = document.createElement("canvas");
      canvas.className = "webgl size-full";
      container.append(canvas);
      // 데모 코드가 three·tweakpane까지 함께 끌고 와서 번들이 커진다 — 이 화면에 들어올 때만 받는다.
      import("@/features/archives/lab/experience/Engine.js").then(
        ({ Engine }) => {
          if (disposed) {
            return;
          }
          const instance: LabEngine = new Engine(canvas, callbacks);
          engine = instance;
          engineRef.current = instance;
          instance
            .init({ restorePosition: restoredPositionRef.current })
            .then(() => {
              if (!disposed) {
                setIsReady(true);
              }
            })
            .catch((error: unknown) => {
              console.error("Engine initialization failed", error);
            });
        },
      );
    }

    return () => {
      disposed = true;
      engineRef.current = null;
      // 다 만들어진 엔진만 맡겨 둔다 — 사진을 받는 중이면 그냥 버린다(init이 isDisposed를 보고 멈춘다)
      if (engine?.isInitialized) {
        parkEngine(engine, canvas, isOpeningRef.current);
      } else {
        engine?.dispose();
        canvas.remove();
      }
    };
  }, [navigate]);

  function handleEnter() {
    engineRef.current?.enter();
    setIsEntered(true);
  }

  return (
    <div className="relative flex-1 overflow-hidden bg-black">
      {/* 캔버스는 effect에서 직접 붙인다 — 앨범에서 돌아오면 맡겨 둔 캔버스를 그대로 다시 붙여야 해서 */}
      <div className="size-full" ref={canvasContainerRef} />

      <div className="pointer-events-none fixed inset-0 z-10">
        {/* 상단 — 뒤로가기만 둔다. 사진 위라 반투명 유리 버튼 */}
        <div className="pt-safe-top">
          <div className="flex h-14 items-center px-4">
            <button
              aria-label="뒤로가기"
              className="pointer-events-auto flex size-10 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur-md active:bg-white/20"
              onClick={() => navigate(-1)}
              type="button"
            >
              <IconChevronLeft />
            </button>
          </div>
        </div>

        {isEntered && activeCard && !isAtEnd && (
          <>
            <ArchivesLabCaption
              card={activeCard}
              onOpen={() => engineRef.current?.openActive("photos")}
              onShiftPhoto={(direction) =>
                engineRef.current?.shiftPhoto(direction)
              }
              totalCount={galleryPlaneData.length}
            />
            <ArchivesLabTimeline
              activeIndex={activeCard.index}
              count={galleryPlaneData.length}
              onScrub={(index) => engineRef.current?.scrollToIndex(index)}
            />
          </>
        )}

        {/* 첫 카드에서만 — 위로 밀면 다음(이전 날짜) 행사로 간다는 걸 알려 준다.
            PC는 가운데 아래가 캡션과 겹쳐서 오른쪽 아래(타임라인 왼쪽)에 두고, 마우스·키보드 문구로 바꾼다 */}
        <div
          className={`absolute inset-x-0 bottom-0 flex flex-col items-center pb-6 text-white/50 text-xs transition-opacity duration-500 min-[769px]:items-end min-[769px]:pr-16 min-[769px]:pb-10 ${
            isEntered && activeCard?.index === 0 && !isOpening
              ? "opacity-100"
              : "opacity-0"
          }`}
        >
          <div className="lab-float flex flex-col items-center">
            <IconChevronUpSmall />
            <span className="min-[769px]:hidden">
              위로 밀어 다음 행사 · 옆으로 밀어 사진 넘기기
            </span>
            <span className="hidden min-[769px]:inline">
              스크롤·↑↓ 키로 다음 행사 · ←→ 키로 사진 넘기기
            </span>
          </div>
          <div className="h-safe-bottom" />
        </div>
      </div>

      {/* 끝 화면 — 마지막 카드를 지나면 진입 화면과 같은 포스터 배경 위로 환영 문구가 뜬다.
          뒤로가기 버튼(z-10)은 위에 남기고, 다시 아래로 밀면 마지막 카드로 돌아간다(스크롤은 window에서 받는다) */}
      <div
        className={`fixed inset-0 isolate z-5 flex flex-col justify-end px-6 text-white transition-opacity duration-700 min-[769px]:px-20 min-[769px]:pb-14 ${
          isEntered && isAtEnd ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <ArchivesLabIntroBackground />
        <p className="font-semibold text-white/50 text-xs tracking-widest">
          STREAM ARCHIVE
        </p>
        <h1 className="mt-3 font-bold text-3xl leading-tight tracking-tight min-[769px]:text-5xl">
          슬랑제: 울림에
          <br />
          오신 걸 환영합니다
        </h1>
        <p className="mt-3 break-keep text-sm text-white/60 leading-relaxed min-[769px]:text-base">
          올해의 마지막 이야기를 함께 만들어요.
        </p>
        <button
          className="mt-8 h-14 rounded-full bg-white font-semibold text-base text-black min-[769px]:w-80 min-[769px]:self-start"
          onClick={() => engineRef.current?.scrollToIndex(0)}
          type="button"
        >
          처음으로
        </button>
        <div className="h-6" />
        <div className="h-safe-bottom" />
      </div>

      {/* 진입 화면 — 들어가면 카드가 멀리서 날아온다 */}
      <div
        className={`fixed inset-0 z-20 flex flex-col justify-end px-6 text-white transition-opacity duration-700 min-[769px]:px-20 min-[769px]:pb-14 ${
          isEntered ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <ArchivesLabIntroBackground />
        <p className="font-semibold text-white/50 text-xs tracking-widest">
          STREAM ARCHIVE
        </p>
        <h1 className="mt-3 font-bold text-3xl leading-tight tracking-tight min-[769px]:text-5xl">
          올해 함께한
          <br />
          순간들
        </h1>
        <p className="mt-3 break-keep text-sm text-white/60 leading-relaxed min-[769px]:text-base">
          <span className="min-[769px]:hidden">
            위로 밀어 올해 행사를 하나씩 둘러보세요.
          </span>
          <span className="hidden min-[769px]:inline">
            스크롤해서 올해 행사를 하나씩 둘러보세요.
          </span>
        </p>
        <button
          className="mt-8 h-14 rounded-full bg-white font-semibold text-base text-black transition-opacity disabled:opacity-40 min-[769px]:w-80 min-[769px]:self-start"
          disabled={!isReady}
          onClick={handleEnter}
          type="button"
        >
          {isReady ? "들어가기" : "사진 불러오는 중…"}
        </button>
        <div className="h-6" />
        <div className="h-safe-bottom" />
      </div>

      {/* 사진·앨범 열기 — 카메라가 카드 속으로 들어가는 동안 상세·현장 사진 화면 배경(흰색)으로 덮는다 */}
      <div
        className={`pointer-events-none fixed inset-0 z-30 bg-white transition-opacity delay-150 duration-300 ${
          isOpening ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
}

export default ArchivesLabScreen;
