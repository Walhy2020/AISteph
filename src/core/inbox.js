import path from "node:path";
import { readdir, readFile } from "node:fs/promises";

const MAX_LIST_LIMIT = 200;

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
  for (const record of records) {
    byType[record.type] = (byType[record.type] ?? 0) + 1;
    byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
  }
  return {
    total: records.length,
    pendingReview: byStatus.pending_review ?? 0,
    byType,
    byStatus
  };
}
