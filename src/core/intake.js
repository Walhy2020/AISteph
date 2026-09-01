import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";

function dayStamp(date) {
  return date.toISOString().slice(0, 10);
}

function compactStamp(date) {
  return date.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function yamlString(value) {
  return JSON.stringify(value ?? "");
}

function normalizeTitle(title, fallback) {
  const normalized = String(title ?? "").trim();
  return normalized || fallback;
}

function safeName(fileName) {
  return fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 120);
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function atomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function relativeFromWorkspace(config, absolutePath) {
  return `./${path.relative(config.workspaceRoot, absolutePath).split(path.sep).join("/")}`;
}

function buildInboxNote(record, content) {
  const audioMetadata = record.type === "audio"
    ? [
        `started_at: ${yamlString(record.startedAt)}`,
        `ended_at: ${yamlString(record.endedAt)}`,
        `duration_seconds: ${record.durationSeconds}`,
        `device_name: ${yamlString(record.deviceName)}`,
        `session_id: ${yamlString(record.sessionId)}`
      ]
    : [];
  const lines = [
    "---",
    `id: ${yamlString(record.id)}`,
    `type: ${yamlString(record.type)}`,
    `status: ${yamlString(record.status)}`,
    `title: ${yamlString(record.title)}`,
    `visibility: ${yamlString(record.visibility)}`,
    `captured_at: ${yamlString(record.capturedAt)}`,
    `content_hash: ${yamlString(record.contentHash)}`,
    `source_url: ${yamlString(record.sourceUrl)}`,
    `source_path: ${yamlString(record.sourcePath)}`,
    `schema_version: ${yamlString(record.schemaVersion)}`,
    ...audioMetadata,
    "tags: []",
    "projects: []",
    "people: []",
    "---",
    "",
    `# ${record.title}`,
    "",
    "## 来源",
    "",
    `- 类型：${record.type}`,
    `- 收录时间：${record.capturedAt}`,
    record.sourceUrl ? `- 原始链接：${record.sourceUrl}` : `- 原始资料：${record.sourcePath}`,
    "",
    "## 原始内容",
    "",
    content || "原始内容保存在上方所列来源中。",
    "",
    "## 审核",
    "",
    "- [ ] 确认来源和事实准确",
    "- [ ] 补充项目、人物和标签",
    "- [ ] 决定是否提炼为正式知识",
    "- [ ] 检查是否包含敏感信息",
    ""
  ];
  return lines.join("\n");
}

async function persistRecord(config, log, record, noteContent) {
  const recordPath = path.join(config.dataRootPath, "records", `${record.id}.json`);
  const queuePath = path.join(config.dataRootPath, "queue", `${record.id}.json`);
  const notePath = path.join(config.vaultRootPath, "00_Inbox", "Review", `${record.id}.md`);
  record.inboxNotePath = relativeFromWorkspace(config, notePath);

  try {
    await atomicJson(recordPath, record);
    await atomicJson(queuePath, {
      sourceId: record.id,
      stage: "captured",
      attempts: 0,
      createdAt: record.capturedAt,
      updatedAt: record.capturedAt
    });
    await mkdir(path.dirname(notePath), { recursive: true });
    await writeFile(notePath, buildInboxNote(record, noteContent), "utf8");
  } catch (error) {
    await Promise.allSettled([
      rm(recordPath, { force: true }),
      rm(queuePath, { force: true }),
      rm(notePath, { force: true })
    ]);
    throw error;
  }

  await log("info", "intake.created", {
    sourceId: record.id,
    sourceType: record.type,
    status: record.status
  }).catch(() => {});
  return record;
}

function createBaseRecord(config, type, title, contentHash, sourceUrl, sourcePath) {
  const now = new Date();
  return {
    id: `SRC-${compactStamp(now)}-${randomUUID().slice(0, 6)}`,
    type,
    status: "pending_review",
    title,
    capturedAt: now.toISOString(),
    visibility: config.defaultVisibility,
    contentHash,
    sourceUrl: sourceUrl || null,
    sourcePath: sourcePath || null,
    inboxNotePath: null,
    schemaVersion: "1.0"
  };
}

export async function addText(config, log, { title, text }) {
  const content = String(text ?? "").trim();
  if (!content) throw new Error("文字内容不能为空");
  const hash = createHash("sha256").update(content, "utf8").digest("hex");
  const now = new Date();
  const record = createBaseRecord(config, "text", normalizeTitle(title, "快速记录"), hash, null, null);
  const sourcePath = path.join(config.dataRootPath, "sources", "text", dayStamp(now), `${record.id}.txt`);
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, `${content}\n`, "utf8");
  record.sourcePath = relativeFromWorkspace(config, sourcePath);
  return persistRecord(config, log, record, content);
}

export async function addLink(config, log, { title, url }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("文章链接格式无效");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("文章链接只允许 http 或 https 协议");
  }
  const normalizedUrl = parsed.toString();
  const hash = createHash("sha256").update(normalizedUrl, "utf8").digest("hex");
  const record = createBaseRecord(
    config,
    "article_link",
    normalizeTitle(title, parsed.hostname),
    hash,
    normalizedUrl,
    null
  );
  return persistRecord(config, log, record, `> 待抓取和分析：${normalizedUrl}`);
}

export async function importFile(config, log, { title, inputPath, originalName: suppliedName }) {
  if (!inputPath) throw new Error("必须提供待导入文件路径");
  const absoluteInput = path.resolve(inputPath);
  const inputInfo = await stat(absoluteInput);
  if (!inputInfo.isFile()) {
    throw new Error("待导入路径必须是普通文件");
  }
  const hash = await sha256File(absoluteInput);
  const now = new Date();
  const originalName = path.basename(String(suppliedName || absoluteInput)).trim();
  if (!originalName) throw new Error("导入文件名不能为空");
  const record = createBaseRecord(
    config,
    "document",
    normalizeTitle(title, originalName),
    hash,
    null,
    null
  );
  const destination = path.join(
    config.dataRootPath,
    "sources",
    "documents",
    dayStamp(now),
    `${record.id}-${safeName(originalName)}`
  );
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(absoluteInput, destination);
  record.sourcePath = relativeFromWorkspace(config, destination);
  return persistRecord(config, log, record, null);
}

export async function addAudio(config, log, {
  title,
  inputPath,
  startedAt,
  endedAt,
  durationSeconds,
  deviceName,
  sessionId
}) {
  const absoluteInput = path.resolve(String(inputPath ?? ""));
  const audioRoot = path.resolve(config.dataRootPath, "audio");
  if (!absoluteInput.startsWith(`${audioRoot}${path.sep}`)) {
    throw new Error("录音文件必须位于配置的数据音频目录中");
  }
  const inputInfo = await stat(absoluteInput);
  if (!inputInfo.isFile() || inputInfo.size === 0) {
    throw new Error("录音文件必须是非空普通文件");
  }
  const started = new Date(startedAt);
  const ended = new Date(endedAt);
  const normalizedDuration = Number(durationSeconds);
  const normalizedDevice = String(deviceName ?? "").trim();
  if (Number.isNaN(started.getTime()) || Number.isNaN(ended.getTime()) || ended < started) {
    throw new Error("录音起止时间无效");
  }
  if (!Number.isFinite(normalizedDuration) || normalizedDuration <= 0) {
    throw new Error("录音时长无效");
  }
  if (!normalizedDevice || normalizedDevice.length > 300) {
    throw new Error("录音设备名称无效");
  }

  const hash = await sha256File(absoluteInput);
  const record = createBaseRecord(
    config,
    "audio",
    normalizeTitle(title, `录音 ${started.toLocaleString("zh-CN", { hour12: false })}`),
    hash,
    null,
    relativeFromWorkspace(config, absoluteInput)
  );
  record.startedAt = started.toISOString();
  record.endedAt = ended.toISOString();
  record.durationSeconds = Math.round(normalizedDuration * 1000) / 1000;
  record.deviceName = normalizedDevice;
  record.sessionId = String(sessionId ?? "");
  return persistRecord(
    config,
    log,
    record,
    `- 录音设备：${record.deviceName}\n- 录音时长：${record.durationSeconds} 秒\n- 音频文件：${record.sourcePath}`
  );
}
