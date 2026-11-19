import archivesData from "@/entities/archives/archivesData.json";
import { ARCHIVES, findArchiveDetail } from "@/entities/archives/archivesMock";
import type { ArchiveDetail, ArchiveItem } from "@/entities/archives/types";
import { mockupApi } from "@/lib/mockupApi";

// 서버에서 받아 둔 아카이빙(scripts/export-archives.mjs가 만든다). 아직 비어 있으면 목데이터를 쓴다.
// 이 페이지는 서버를 부르지 않고 이 파일을 함께 배포한다 — 화면은 이 함수들로만 데이터를 받는다.
export const REAL_ARCHIVES: ArchiveDetail[] = archivesData;
const hasRealArchives = REAL_ARCHIVES.length > 0;

export function fetchArchives(): Promise<ArchiveItem[]> {
  return mockupApi("archives", () =>
    hasRealArchives ? REAL_ARCHIVES : ARCHIVES,
  );
}

// 없는 앨범은 null — 상세·현장 사진 화면이 "존재하지 않는 아카이빙이에요" 빈 상태를 그린다.
export function fetchArchive(archiveId: string): Promise<ArchiveDetail | null> {
  return mockupApi(`archives/${archiveId}`, () =>
    hasRealArchives
      ? (REAL_ARCHIVES.find((archive) => archive.id === archiveId) ?? null)
      : findArchiveDetail(archiveId),
  );
}
