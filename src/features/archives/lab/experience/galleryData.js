import alumniPanelTalk from "@/assets/images/archives/alumni-panel-talk.jpg";
import freshmanOrientation from "@/assets/images/archives/freshman-orientation.jpg";
import haeoreumje from "@/assets/images/archives/haeoreumje.jpg";
import snackEvent from "@/assets/images/archives/snack-event.jpg";
import sportsDay from "@/assets/images/archives/sports-day.jpg";
import { ARCHIVES, findArchiveDetail } from "@/entities/archives/archivesMock";

// 원본 데모(galleryData.js)는 사진마다 색을 손으로 지정해 둔다. 여기서는 배경색을 사진에서 뽑아 쓰고
// (Gallery.extractPalette), 아래 색은 사진을 못 불러왔을 때만 쓰는 대체값이다.
// 실제 아카이빙 목데이터(entities/archives)는 5장뿐이라, 스크롤 맛을 보려고 lab 전용 항목을 더 넣는다.
const FALLBACK_COLOR = "#2b2118";

const IMAGES = [haeoreumje, snackEvent, alumniPanelTalk, sportsDay, freshmanOrientation];

// 카드가 좌우로 번갈아 놓이면서 깊이로 들어가는 배치(원본과 같은 모양)
const X_OFFSETS = [-0.9, 0.8, -0.7, 1, -0.7, 0.9, -0.8, 0.7];

// lab 전용 추가 항목 — entities 목데이터를 건드리지 않고 장수만 늘린다.
const EXTRA_ARCHIVES = [
  { date: "2023.11.24", id: "lab-1", title: "2023-2 과잠 공동구매" },
  { date: "2023.09.15", id: "lab-2", title: "2023-2 개강총회" },
  { date: "2023.05.19", id: "lab-3", title: "2023 소융대 해커톤" },
  { date: "2023.03.07", id: "lab-4", title: "2023-1 새내기 배움터" },
  { date: "2022.12.20", id: "lab-5", title: "2022-2 학생회 송년회" },
  { date: "2022.10.08", id: "lab-6", title: "2022 소융대 체육대회" },
  { date: "2022.04.21", id: "lab-7", title: "2022-1 중간고사 간식행사" },
];

const galleryPlaneData = [...ARCHIVES, ...EXTRA_ARCHIVES].map((archive, index) => {
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
    year: archive.date.slice(0, 4),
  };
});

export { galleryPlaneData };
