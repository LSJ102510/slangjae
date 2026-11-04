// Engine(JS)이 onActiveChange로 넘기는 활성 카드 정보
export interface LabActiveCard {
  index: number;
  archiveId: string;
  label: { word: string; date: string };
  photoIndex: number;
  photoCount: number;
  /** 멈춰 있을 때 카드의 화면 영역(px) — top은 카드 아래 끝. 캡션을 여기에 사진 폭으로 붙인다 */
  captionRect: { left: number; top: number; width: number };
}
