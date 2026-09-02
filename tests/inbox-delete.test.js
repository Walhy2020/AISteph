import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import { loadConfig } from "../src/core/config.js";
import { createLogger } from "../src/core/logger.js";
import { deleteAudioRecord, listInbox } from "../src/core/inbox.js";
import { addAudio } from "../src/core/intake.js";
import { initializeWorkspace } from "../src/core/workspace.js";

async function createTestContext() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "aisteph-delete-test-"));
  const config = await loadConfig(workspaceRoot);
  const log = createLogger(config);
  await initializeWorkspace(config);
  return { workspaceRoot, config, log };
}

async function createAudioRecord(context) {
  const audioPath = path.join(context.config.dataRootPath, "audio", "2026-09-02", "REC-DELETE.opus");
  await mkdir(path.dirname(audioPath), { recursive: true });
  await writeFile(audioPath, Buffer.from("temporary audio fixture"));
  const record = await addAudio(context.config, context.log, {
    title: "待删除测试录音",
    inputPath: audioPath,
    startedAt: "2026-09-02T01:00:00.000Z",
    endedAt: "2026-09-02T01:00:05.000Z",
    durationSeconds: 5,
    deviceName: "Test Microphone",
    sessionId: "REC-DELETE"
  });
  return { record, audioPath };
}

test("删除录音会同步清理音频、记录、队列和Obsidian待审核笔记", async (t) => {
  const context = await createTestContext();
  t.after(() => rm(context.workspaceRoot, { recursive: true, force: true }));
  const { record, audioPath } = await createAudioRecord(context);
  const recordPath = path.join(context.config.dataRootPath, "records", `${record.id}.json`);
  const queuePath = path.join(context.config.dataRootPath, "queue", `${record.id}.json`);
  const notePath = path.resolve(context.workspaceRoot, record.inboxNotePath);

  assert.deepEqual(await deleteAudioRecord(context.config, context.log, record.id), {
    deleted: true,
    sourceId: record.id
  });
  for (const filePath of [audioPath, recordPath, queuePath, notePath]) {
    assert.equal(existsSync(filePath), false);
  }
  assert.equal((await listInbox(context.config, { type: "audio" })).length, 0);
  const logText = await readFile(
    path.join(context.config.logsRootPath, `aisteph-${new Date().toISOString().slice(0, 10)}.jsonl`),
    "utf8"
  );
  assert.match(logText, /inbox\.audio_deleted/);
});

test("删除录音拒绝无效ID、不存在记录和非音频记录", async (t) => {
  const context = await createTestContext();
  t.after(() => rm(context.workspaceRoot, { recursive: true, force: true }));

  await assert.rejects(
    () => deleteAudioRecord(context.config, context.log, "../escape"),
    (error) => error.statusCode === 400
  );
  await assert.rejects(
    () => deleteAudioRecord(context.config, context.log, "SRC-NOT-FOUND"),
    (error) => error.statusCode === 404
  );

  const textId = "SRC-TEXT-DELETE-TEST";
  await writeFile(
    path.join(context.config.dataRootPath, "records", `${textId}.json`),
    JSON.stringify({ id: textId, type: "text" }),
    "utf8"
  );
  await assert.rejects(
    () => deleteAudioRecord(context.config, context.log, textId),
    (error) => error.statusCode === 409
  );
});

test("删除录音拒绝目录外路径并保留外部文件和主记录", async (t) => {
  const context = await createTestContext();
  t.after(() => rm(context.workspaceRoot, { recursive: true, force: true }));
  const { record } = await createAudioRecord(context);
  const outsidePath = path.join(context.config.dataRootPath, "outside.opus");
  const recordPath = path.join(context.config.dataRootPath, "records", `${record.id}.json`);
  await writeFile(outsidePath, "must remain", "utf8");
  const tampered = JSON.parse(await readFile(recordPath, "utf8"));
  tampered.sourcePath = "./data/outside.opus";
  await writeFile(recordPath, JSON.stringify(tampered), "utf8");

  await assert.rejects(
    () => deleteAudioRecord(context.config, context.log, record.id),
    (error) => error.statusCode === 409 && /路径不安全/.test(error.message)
  );
  assert.equal(existsSync(outsidePath), true);
  assert.equal(existsSync(recordPath), true);
});
