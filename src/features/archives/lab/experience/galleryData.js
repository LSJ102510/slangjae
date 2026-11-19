import alumniPanelTalk from "@/assets/images/archives/alumni-panel-talk.jpg";
import freshmanOrientation from "@/assets/images/archives/freshman-orientation.jpg";
import haeoreumje from "@/assets/images/archives/haeoreumje.jpg";
import snackEvent from "@/assets/images/archives/snack-event.jpg";
import sportsDay from "@/assets/images/archives/sports-day.jpg";
import { REAL_ARCHIVES } from "@/entities/archives/archivesApi";
import { ARCHIVES, findArchiveDetail } from "@/entities/archives/archivesMock";

// 원본 데모(galleryData.js)는 사진마다 색을 손으로 지정해 둔다. 여기서는 배경색을 사진에서 뽑아 쓰고
// (Gallery.extractPalette), 아래 색은 사진을 못 불러왔을 때만 쓰는 대체값이다.
// 실제 아카이빙 목데이터(entities/archives)는 5장뿐이라, 스크롤 맛을 보려고 lab 전용 항목을 더 넣는다.
const FALLBACK_COLOR = "#17348a";

const IMAGES = [haeoreumje, snackEvent, alumniPanelTalk, sportsDay, freshmanOrientation];

// 카드가 좌우로 번갈아 놓이면서 깊이로 들어가는 배치(원본과 같은 모양)
const X_OFFSETS = [-0.9, 0.8, -0.7, 1, -0.7, 0.9, -0.8, 0.7];

// 올해 행사만 보여 준다 — 연도 구분(연도 글자·타임라인 연도)이 필요 없는 화면이다.
const CURRENT_YEAR = String(new Date().getFullYear());

// lab 목업은 날짜(와 제목 앞 연도)를 2026년으로 옮겨 쓴다 — entities 목데이터(2024~2025)를 그대로 쓰면
// 올해로 거를 때 하나도 안 남는다. 실제 API가 붙으면 이 연도 바꾸기만 빼면 된다(거르는 건 그대로 둔다).
const LAB_MOCK_YEAR = "2026";

// lab 전용 추가 항목 — entities 목데이터를 건드리지 않고 장수만 늘린다.
const EXTRA_ARCHIVES = [
  { date: "2026.10.30", id: "lab-1", title: "슬랑제: 울림 럭키드로우" },
  { date: "2026.09.25", id: "lab-2", title: "2026-2 과잠 공동구매" },
  { date: "2026.09.02", id: "lab-3", title: "2026-2 개강총회" },
  { date: "2026.06.12", id: "lab-4", title: "2026-1 기말고사 간식행사" },
  { date: "2026.05.22", id: "lab-5", title: "2026 소융대 해커톤" },
];

const labArchives = [
  ...ARCHIVES.map((archive) => ({
    ...archive,
    date: archive.date.replace(/^\d{4}/, LAB_MOCK_YEAR),
    title: archive.title.replace(/^\d{4}/, LAB_MOCK_YEAR),
  })),
  ...EXTRA_ARCHIVES,
]
  .filter((archive) => archive.date.startsWith(CURRENT_YEAR))
  // 최근 행사부터 — 날짜가 "YYYY.MM.DD" 문자열이라 문자열 비교가 곧 날짜 순서다
  .sort((a, b) => b.date.localeCompare(a.date));

const mockPlaneData = labArchives.map((archive, index) => {
  const image = archive.image || IMAGES[index % IMAGES.length];
  // lab 전용 항목은 상세가 없어서, 눌렀을 때 열 앨범(과 넘겨 볼 현장 사진)은 실제 목데이터를 돌려 쓴다.
  const detail = findArchiveDetail(archive.id) ?? findArchiveDetail(ARCHIVES[index % ARCHIVES.length].id);

  return {
    archiveId: detail?.id ?? archive.id,
    fallbackColor: FALLBACK_COLOR,
    // 라벨에는 아카이빙 제목과 날짜를 넣는다(원본의 word/pms 자리 — 색 견본 데모라 PMS 코드였다).
    label: { color: "#f4f4f4", date: archive.date, word: archive.title },
    // 대표 사진을 첫 장으로 두고 현장 사진을 잇는다 — 카드에서 좌우로 넘겨 본다.
    photos: [image, ...(detail?.photos ?? [])],
    position: { x: X_OFFSETS[index % X_OFFSETS.length], y: 0 },
    textureSrc: image,
  };
});

// 서버에서 받아 둔 올해 아카이빙이 있으면 그걸 쓴다(대표 사진을 첫 장으로 현장 사진을 잇는다).
// 사진이 한 장도 없는 행사는 카드로 그릴 수 없어서 뺀다
const realPlaneData = REAL_ARCHIVES.filter(
  (archive) =>
    archive.date.startsWith(CURRENT_YEAR) &&
    (archive.image || archive.photos.length > 0),
)
  // 한 해를 처음부터 따라가도록 오래된 행사부터 — 날짜가 "YYYY.MM.DD"라 문자열 비교가 곧 날짜 순서다
  .sort((a, b) => a.date.localeCompare(b.date))
  .map((archive, index) => {
  const photos = archive.photos.filter((photo) => photo !== archive.image);
  return {
    archiveId: archive.id,
    fallbackColor: FALLBACK_COLOR,
    label: { color: "#f4f4f4", date: archive.date, word: archive.title },
    photos: archive.image ? [archive.image, ...photos] : photos,
    position: { x: X_OFFSETS[index % X_OFFSETS.length], y: 0 },
    textureSrc: archive.image || photos[0],
  };
});

const galleryPlaneData = realPlaneData.length > 0 ? realPlaneData : mockPlaneData;

export { galleryPlaneData };
