import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import { createAudioUrl } from "../src/core/media.js";
import { createAIStephServer } from "../src/server.js";

async function createTestServer(t) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "aisteph-media-test-"));
  const app = await createAIStephServer({ workspaceRoot, port: 0 });
  const origin = await app.start();
  t.after(async () => {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });
  return { app, origin, workspaceRoot };
}

async function writeRecord(app, record) {
  await writeFile(
    path.join(app.config.dataRootPath, "records", `${record.id}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8"
  );
}

async function createAudioFixture(app) {
  const id = "SRC-AUDIO-FIXTURE";
  const audioBytes = Buffer.from("0123456789abcdef", "utf8");
  const audioDirectory = path.join(app.config.dataRootPath, "audio", "2026-09-01");
  await mkdir(audioDirectory, { recursive: true });
  await writeFile(path.join(audioDirectory, "REC-TEST.opus"), audioBytes);
  await writeRecord(app, {
    id,
    type: "audio",
    status: "pending_review",
    title: "媒体接口测试录音",
    capturedAt: "2026-09-01T01:02:03.000Z",
    sourcePath: "./data/audio/2026-09-01/REC-TEST.opus",
    durationSeconds: 61.212,
    deviceName: "Test Microphone"
  });
  return { id, audioBytes };
}

test("录音资料返回签名播放地址、录音统计和完整音频", async (t) => {
  const { app, origin } = await createTestServer(t);
  const fixture = await createAudioFixture(app);
  const headers = { "X-AISteph-Token": app.token };

  const statusResponse = await fetch(`${origin}/api/status`, { headers });
  const status = await statusResponse.json();
  assert.equal(status.stats.audio.total, 1);
  assert.equal(status.stats.audio.durationSeconds, 61.212);
  assert.equal(status.stats.audio.pendingReview, 1);

  const inboxResponse = await fetch(`${origin}/api/inbox?type=audio`, { headers });
  const inbox = await inboxResponse.json();
  assert.equal(inbox.items.length, 1);
  assert.match(inbox.items[0].audioUrl, /^\/api\/audio\/SRC-AUDIO-FIXTURE\?access=/);

  const audioResponse = await fetch(`${origin}${inbox.items[0].audioUrl}`);
  assert.equal(audioResponse.status, 200);
  assert.equal(audioResponse.headers.get("content-type"), "audio/ogg");
  assert.equal(audioResponse.headers.get("accept-ranges"), "bytes");
  assert.deepEqual(Buffer.from(await audioResponse.arrayBuffer()), fixture.audioBytes);
});

test("播放器支持HEAD、Range和后缀Range，并拒绝无效范围与签名", async (t) => {
  const { app, origin } = await createTestServer(t);
  const fixture = await createAudioFixture(app);
  const audioUrl = createAudioUrl(app.token, fixture.id);

  const headResponse = await fetch(`${origin}${audioUrl}`, { method: "HEAD" });
  assert.equal(headResponse.status, 200);
  assert.equal(headResponse.headers.get("content-length"), String(fixture.audioBytes.length));
  assert.equal((await headResponse.arrayBuffer()).byteLength, 0);

  const rangeResponse = await fetch(`${origin}${audioUrl}`, {
    headers: { Range: "bytes=2-5" }
  });
  assert.equal(rangeResponse.status, 206);
  assert.equal(rangeResponse.headers.get("content-range"), "bytes 2-5/16");
  assert.equal(await rangeResponse.text(), "2345");

  const suffixResponse = await fetch(`${origin}${audioUrl}`, {
    headers: { Range: "bytes=-4" }
  });
  assert.equal(suffixResponse.status, 206);
  assert.equal(await suffixResponse.text(), "cdef");

  const invalidRange = await fetch(`${origin}${audioUrl}`, {
    headers: { Range: "bytes=99-100" }
  });
  assert.equal(invalidRange.status, 416);
  assert.equal(invalidRange.headers.get("content-range"), "bytes */16");

  const invalidAccess = await fetch(`${origin}/api/audio/${fixture.id}?access=invalid`);
  assert.equal(invalidAccess.status, 403);
});

test("播放接口拒绝非音频记录、目录逃逸和非GET方法", async (t) => {
  const { app, origin } = await createTestServer(t);
  await writeRecord(app, {
    id: "SRC-TEXT-FIXTURE",
    type: "text",
    status: "pending_review",
    sourcePath: "./data/audio/fake.opus"
  });
  await writeRecord(app, {
    id: "SRC-ESCAPE-FIXTURE",
    type: "audio",
    status: "pending_review",
    sourcePath: "./data/audio/../outside.opus"
  });

  const nonAudio = await fetch(`${origin}${createAudioUrl(app.token, "SRC-TEXT-FIXTURE")}`);
  assert.equal(nonAudio.status, 404);

  const escaped = await fetch(`${origin}${createAudioUrl(app.token, "SRC-ESCAPE-FIXTURE")}`);
  assert.equal(escaped.status, 403);

  const postResponse = await fetch(`${origin}${createAudioUrl(app.token, "SRC-TEXT-FIXTURE")}`, {
    method: "POST"
  });
  assert.equal(postResponse.status, 405);
});