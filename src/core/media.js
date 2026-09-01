import path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";

const SOURCE_ID_PATTERN = /^SRC-[A-Za-z0-9-]+$/;

export class MediaError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "MediaError";
    this.statusCode = statusCode;
  }
}

export function createAudioAccessToken(serverToken, sourceId) {
  return createHmac("sha256", serverToken)
    .update(`audio:${sourceId}`, "utf8")
    .digest("base64url");
}

export function createAudioUrl(serverToken, sourceId) {
  const access = createAudioAccessToken(serverToken, sourceId);
  return `/api/audio/${encodeURIComponent(sourceId)}?access=${encodeURIComponent(access)}`;
}

function validAccess(serverToken, sourceId, suppliedAccess) {
  const expected = Buffer.from(createAudioAccessToken(serverToken, sourceId));
  const supplied = Buffer.from(String(suppliedAccess ?? ""));
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function loadAudioRecord(config, sourceId) {
  if (!SOURCE_ID_PATTERN.test(sourceId)) {
    throw new MediaError(400, "录音记录ID无效");
  }
  let record;
  try {
    record = JSON.parse(
      await readFile(path.join(config.dataRootPath, "records", `${sourceId}.json`), "utf8")
    );
  } catch (error) {
    if (error.code === "ENOENT") throw new MediaError(404, "录音记录不存在");
    throw error;
  }
  if (record.id !== sourceId || record.type !== "audio" || !record.sourcePath) {
    throw new MediaError(404, "录音记录不存在");
  }

  const audioRoot = path.resolve(config.dataRootPath, "audio");
  const audioPath = path.resolve(config.workspaceRoot, record.sourcePath);
  const relativeAudioPath = path.relative(audioRoot, audioPath);
  if (!relativeAudioPath
    || relativeAudioPath === ".."
    || relativeAudioPath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeAudioPath)) {
    throw new MediaError(403, "录音路径超出允许目录");
  }
  const fileInfo = await stat(audioPath).catch((error) => {
    if (error.code === "ENOENT") throw new MediaError(404, "录音文件不存在");
    throw error;
  });
  if (!fileInfo.isFile() || fileInfo.size <= 0) {
    throw new MediaError(404, "录音文件无效");
  }
  return { audioPath, fileInfo };
}

export function parseRange(rangeHeader, fileSize) {
  if (!rangeHeader) return null;
  const match = String(rangeHeader).match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) {
    throw new MediaError(416, "音频范围请求无效");
  }

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      throw new MediaError(416, "音频范围请求无效");
    }
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : fileSize - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || start >= fileSize || end < start) {
    throw new MediaError(416, "音频范围请求无效");
  }
  return { start, end: Math.min(end, fileSize - 1) };
}

export async function serveAudio(config, request, response, {
  sourceId,
  access,
  serverToken
}) {
  if (!["GET", "HEAD"].includes(request.method)) {
    throw new MediaError(405, "请求方法不支持");
  }
  if (!validAccess(serverToken, sourceId, access)) {
    throw new MediaError(403, "录音访问令牌无效");
  }

  const { audioPath, fileInfo } = await loadAudioRecord(config, sourceId);
  let range;
  try {
    range = parseRange(request.headers.range, fileInfo.size);
  } catch (error) {
    if (error.statusCode === 416) {
      response.writeHead(416, {
        "Content-Range": `bytes */${fileInfo.size}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      response.end();
      return;
    }
    throw error;
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? fileInfo.size - 1;
  const headers = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Type": "audio/ogg",
    "Content-Length": end - start + 1,
    "Content-Disposition": `inline; filename="${sourceId}.opus"`,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${fileInfo.size}`;
  response.aistephAudioBytes = end - start + 1;
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  await new Promise((resolve, reject) => {
    const audioStream = createReadStream(audioPath, { start, end });
    const cleanup = () => {
      audioStream.off("error", fail);
      response.off("finish", finish);
      response.off("close", close);
    };
    const finish = () => {
      cleanup();
      resolve();
    };
    const fail = (error) => {
      cleanup();
      reject(error);
    };
    const close = () => {
      audioStream.destroy();
      finish();
    };
    audioStream.once("error", fail);
    response.once("finish", finish);
    response.once("close", close);
    audioStream.pipe(response);
  });
}