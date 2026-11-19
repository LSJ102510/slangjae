// stream-server 아카이빙을 받아 이 페이지에 정적으로 넣는다(서버를 부르지 않고 배포).
//   ARCHIVE_API_BASE=https://<api 주소> ARCHIVE_TOKEN=<학생 access token> node scripts/export-archives.mjs
// - 목록: GET /v1/app/archives?year=<올해>, 상세: GET /v1/app/archives/{id} (학생 로그인 필요)
// - 사진은 내려받아 긴 변 1200px JPEG(품질 70)로 줄여 public/assets/archives/{id}/ 아래에 둔다(macOS sips 사용).
//   vercel.json이 /assets/ 아래 파일만 열어 두어서 그 아래에 둔다.
// - 받은 내용은 src/entities/archives/archivesData.json 하나로 저장하고, 화면은 이 파일이 비어 있지 않으면 이걸 쓴다.
// 다시 돌리면 이전 결과를 지우고 새로 받는다.
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const API_BASE = process.env.ARCHIVE_API_BASE?.replace(/\/$/, "");
const TOKEN = process.env.ARCHIVE_TOKEN;
const YEAR = Number(process.env.ARCHIVE_YEAR ?? new Date().getFullYear());
const MAX_SIDE = 1200;
const CONCURRENCY = 6;

const ROOT = path.resolve(import.meta.dirname, "..");
const ASSET_DIR = path.join(ROOT, "public/assets/archives");
const DATA_FILE = path.join(ROOT, "src/entities/archives/archivesData.json");
// 이 페이지에 넣지 않는 아카이빙 id — 슬랑제용으로 11월 19일에 새로 등록한 것(id 7~)만 쓰고, 그 전에 있던 것은 뺀다
const EXCLUDED_IDS = new Set(["1", "2"]);
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

if (!API_BASE || !TOKEN) {
  console.error("ARCHIVE_API_BASE와 ARCHIVE_TOKEN을 넣어 주세요.");
  process.exit(1);
}

async function api(pathname) {
  const response = await fetch(`${API_BASE}${pathname}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // JSON이 아니면 API 주소가 아니라 웹 페이지 주소를 넣었을 가능성이 크다
    throw new Error(
      `${pathname} 응답이 JSON이 아니에요 (${response.status}, ${response.headers.get("content-type")}). ` +
        `ARCHIVE_API_BASE가 웹 주소가 아니라 API 주소인지 확인해 주세요. 응답 앞부분: ${text.slice(0, 80)}`,
    );
  }
  // 서버 응답은 { success, code, message, data } 모양이다
  if (!response.ok || body?.success === false || body?.data === undefined) {
    throw new Error(
      `${pathname} 요청 실패 (${response.status} ${body?.code ?? ""} ${body?.message ?? ""}) ` +
        `응답 키: ${Object.keys(body ?? {}).join(", ")}`,
    );
  }
  return body.data;
}

// "2026-10-30" → "2026.10.30"
function dotDate(isoDate) {
  return isoDate.replaceAll("-", ".");
}

// 상세의 일시 — "2026.10.30 (금)", 여러 날이면 "2026.10.30 (금) - 10.31 (토)"
function schedule(startDate, endDate) {
  const label = (iso) => `(${WEEKDAYS[new Date(`${iso}T00:00:00`).getDay()]})`;
  const start = `${dotDate(startDate)} ${label(startDate)}`;
  if (!endDate || endDate === startDate) {
    return start;
  }
  return `${start} - ${dotDate(endDate).slice(5)} ${label(endDate)}`;
}

async function download(url, outFile) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`사진 받기 실패 (${response.status}) ${url}`);
  }
  const tempFile = `${outFile}.download`;
  await writeFile(tempFile, Buffer.from(await response.arrayBuffer()));
  // 갤러리가 들어가기 전에 사진을 모두 미리 받아서 폰에서 무겁지 않게 긴 변을 줄이고 JPEG로 바꾼다(PNG·HEIC로 올린 사진도 같은 형식이 된다)
  await run("sips", [
    "-Z",
    String(MAX_SIDE),
    "-s",
    "format",
    "jpeg",
    "-s",
    "formatOptions",
    "70",
    tempFile,
    "--out",
    outFile,
  ]);
  await rm(tempFile);
}

// 동시에 CONCURRENCY개씩 받는다
async function downloadAll(jobs) {
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next];
      next += 1;
      await download(job.url, job.outFile);
      done += 1;
      process.stdout.write(`\r사진 ${done}/${jobs.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write("\n");
}

const list = await api(`/v1/app/archives?year=${YEAR}`);
console.log(`${YEAR}년 아카이빙 ${list.archives.length}개`);

await rm(ASSET_DIR, { force: true, recursive: true });
const jobs = [];
const archives = [];

for (const item of list.archives) {
  if (EXCLUDED_IDS.has(String(item.archiveId))) {
    continue;
  }
  const detail = await api(`/v1/app/archives/${item.archiveId}`);
  const id = String(detail.archiveId);
  const dir = path.join(ASSET_DIR, id);
  await mkdir(dir, { recursive: true });

  const photos = detail.images.map((image, index) => {
    const name = `${String(index + 1).padStart(2, "0")}.jpg`;
    jobs.push({ outFile: path.join(dir, name), url: image.fileUrl });
    return `/assets/archives/${id}/${name}`;
  });
  // 대표 사진은 보통 현장 사진 중 하나라 그 파일을 그대로 쓴다(같은 사진을 두 번 받으면 갤러리에서 두 번 넘겨진다).
  // 현장 사진에 없는 대표 사진만 따로 받고, 대표 사진이 없으면 첫 현장 사진을 쓴다
  const coverIndex = detail.images.findIndex(
    (image) => image.fileUrl === item.thumbnailUrl,
  );
  let image = photos[coverIndex >= 0 ? coverIndex : 0] ?? "";
  if (item.thumbnailUrl && coverIndex < 0) {
    jobs.push({ outFile: path.join(dir, "cover.jpg"), url: item.thumbnailUrl });
    image = `/assets/archives/${id}/cover.jpg`;
  }

  archives.push({
    activity: detail.content ?? "",
    date: dotDate(detail.startDate),
    department: detail.departmentName ?? "",
    id,
    image,
    links: detail.relatedEvent ? [detail.relatedEvent.title] : [],
    location: detail.location ?? "",
    photos,
    schedule: schedule(detail.startDate, detail.endDate),
    title: detail.title,
  });
  console.log(`- ${detail.title} (사진 ${photos.length}장)`);
}

await downloadAll(jobs);

// 최근 행사부터 — 날짜가 "YYYY.MM.DD"라 문자열 비교가 곧 날짜 순서다
archives.sort((a, b) => b.date.localeCompare(a.date));
await writeFile(DATA_FILE, `${JSON.stringify(archives, null, 2)}\n`);

const { stdout } = await run("du", ["-sh", ASSET_DIR]);
console.log(`저장: ${path.relative(ROOT, DATA_FILE)}`);
console.log(`사진 용량: ${stdout.trim().split("\t")[0]}`);
