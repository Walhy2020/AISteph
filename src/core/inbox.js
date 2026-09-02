import path from "node:path";
import { readdir, readFile, rm } from "node:fs/promises";

const MAX_LIST_LIMIT = 200;
const SOURCE_ID_PATTERN = /^SRC-[A-Za-z0-9-]+$/;

export class InboxRecordError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "InboxRecordError";
    this.statusCode = statusCode;
  }
}

function resolveContainedPath(rootPath, suppliedPath, errorMessage) {
  if (typeof suppliedPath !== "string" || !suppliedPath.trim()) {
    throw new InboxRecordError(409, errorMessage);
  }
  const root = path.resolve(rootPath);
  const resolved = path.resolve(suppliedPath);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new InboxRecordError(409, errorMessage);
  }
  return resolved;
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(parsed, 1), MAX_LIST_LIMIT);
}

function publicRecord(record) {
  return {
    id: record.id,
    type: record.type,
    status: record.status,
    title: record.title,
    capturedAt: record.capturedAt,
    visibility: record.visibility,
    contentHash: record.contentHash,
    sourceUrl: record.sourceUrl,
    sourcePath: record.sourcePath,
    inboxNotePath: record.inboxNotePath,
    schemaVersion: record.schemaVersion,
    startedAt: record.startedAt ?? null,
    endedAt: record.endedAt ?? null,
    durationSeconds: record.durationSeconds ?? null,
    deviceName: record.deviceName ?? null,
    sessionId: record.sessionId ?? null
  };
}

async function readRecords(config) {
  let entries;
  try {
    entries = await readdir(path.join(config.dataRootPath, "records"), {
      withFileTypes: true
    });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  const records = [];
  for (const name of names) {
    try {
      const record = JSON.parse(
        await readFile(path.join(config.dataRootPath, "records", name), "utf8")
      );
      records.push(record);
    } catch (error) {
      records.push({
        id: name.slice(0, -5),
        type: "unknown",
        status: "read_error",
        title: "记录读取失败",
        capturedAt: null,
        visibility: "private",
        contentHash: null,
        sourceUrl: null,
        sourcePath: null,
        inboxNotePath: null,
        schemaVersion: null,
        readError: error.message
      });
    }
  }
  return records;
}

export async function listInbox(config, options = {}) {
  const limit = normalizeLimit(options.limit);
  const type = String(options.type ?? "").trim();
  const status = String(options.status ?? "").trim();

  const records = await readRecords(config);
  return records
    .filter((record) => !type || record.type === type)
    .filter((record) => !status || record.status === status)
    .slice(0, limit)
    .map(publicRecord);
}

export async function getInboxStats(config) {
  const records = await readRecords(config);
  const byType = {};
  const byStatus = {};
  let audioDurationSeconds = 0;
  let audioPendingReview = 0;
  for (const record of records) {
    byType[record.type] = (byType[record.type] ?? 0) + 1;
    byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
    if (record.type === "audio") {
      const duration = Number(record.durationSeconds);
      if (Number.isFinite(duration) && duration > 0) audioDurationSeconds += duration;
      if (record.status === "pending_review") audioPendingReview += 1;
    }
  }
  return {
    total: records.length,
    pendingReview: byStatus.pending_review ?? 0,
    audio: {
      total: byType.audio ?? 0,
      durationSeconds: Math.round(audioDurationSeconds * 1000) / 1000,
      pendingReview: audioPendingReview
    },
    byType,
    byStatus
  };
}

export async function deleteAudioRecord(config, log, sourceId) {
  if (!SOURCE_ID_PATTERN.test(String(sourceId ?? ""))) {
    throw new InboxRecordError(400, "录音记录ID无效");
  }

  const recordPath = path.join(config.dataRootPath, "records", `${sourceId}.json`);
  let record;
  try {
    record = JSON.parse(await readFile(recordPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new InboxRecordError(404, "录音记录不存在");
    }
    throw new InboxRecordError(409, "录音记录无法读取，未执行删除");
  }

  if (record.id !== sourceId || record.type !== "audio") {
    throw new InboxRecordError(409, "该记录不是可删除的录音记录");
  }

  const sourcePath = typeof record.sourcePath === "string"
    ? path.resolve(config.workspaceRoot, record.sourcePath)
    : record.sourcePath;
  const inboxNotePath = typeof record.inboxNotePath === "string"
    ? path.resolve(config.workspaceRoot, record.inboxNotePath)
    : record.inboxNotePath;
  const audioPath = resolveContainedPath(
    path.join(config.dataRootPath, "audio"),
    sourcePath,
    "录音文件路径不安全，未执行删除"
  );
  const notePath = resolveContainedPath(
    path.join(config.vaultRootPath, "00_Inbox", "Review"),
    inboxNotePath,
    "待审核笔记路径不安全，未执行删除"
  );
  const queuePath = path.join(config.dataRootPath, "queue", `${sourceId}.json`);

  try {
    await Promise.all([
      rm(audioPath, { force: true }),
      rm(queuePath, { force: true }),
      rm(notePath, { force: true })
    ]);
    await rm(recordPath);
  } catch {
    throw new InboxRecordError(500, "录音相关文件清理失败，记录已保留以便重试");
  }

  await log("info", "inbox.audio_deleted", {
    sourceId,
    title: record.title ?? null
  }).catch(() => {});

  return { deleted: true, sourceId };
}
