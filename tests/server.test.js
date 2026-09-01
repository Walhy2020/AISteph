import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import { createAIStephServer } from "../src/server.js";

async function createTestServer(t, customConfig = {}, serverOptions = {}) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "aisteph-server-test-"));
  if (Object.keys(customConfig).length) {
    await mkdir(path.join(workspaceRoot, "config"));
    await writeFile(
      path.join(workspaceRoot, "config", "aisteph.json"),
      JSON.stringify(customConfig),
      "utf8"
    );
  }
  const app = await createAIStephServer({ workspaceRoot, port: 0, ...serverOptions });
  const origin = await app.start();
  t.after(async () => {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });
  return { app, origin, workspaceRoot };
}

function tokenHeaders(app, origin, extra = {}) {
  return {
    "X-AISteph-Token": app.token,
    Origin: origin,
    ...extra
  };
}

test("管理台显示v0.4.0且页面只展示录音工作台", async (t) => {
  const { origin } = await createTestServer(t);
  const response = await fetch(origin);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /AISteph v0\.4\.0/);
  assert.match(html, /type="module"/);
  assert.match(html, /id="recorder-status"/);
  assert.match(html, /id="recording-list"/);
  assert.match(html, /<audio controls preload="metadata"><\/audio>/);
  assert.doesNotMatch(html, /id="text-form"/);
  assert.doesNotMatch(html, /id="link-form"/);
  assert.doesNotMatch(html, /id="file-form"/);
  assert.doesNotMatch(html, /id="type-filter"/);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("API要求本地令牌并拒绝跨来源写入", async (t) => {
  const { app, origin } = await createTestServer(t);
  const unauthorized = await fetch(`${origin}/api/status`);
  assert.equal(unauthorized.status, 403);

  const crossOrigin = await fetch(`${origin}/api/intake/text`, {
    method: "POST",
    headers: tokenHeaders(app, "https://untrusted.example", {
      "Content-Type": "application/json"
    }),
    body: JSON.stringify({ text: "不应写入" })
  });
  assert.equal(crossOrigin.status, 403);

  const status = await fetch(`${origin}/api/status`, {
    headers: tokenHeaders(app, origin)
  });
  assert.equal(status.status, 200);
  assert.equal((await status.json()).version, "0.4.0");
});

test("网页API可收录文字、链接和文件并查询待审核列表", async (t) => {
  const { app, origin } = await createTestServer(t);

  const textResponse = await fetch(`${origin}/api/intake/text`, {
    method: "POST",
    headers: tokenHeaders(app, origin, { "Content-Type": "application/json" }),
    body: JSON.stringify({ title: "网页验收文字", text: "只应写入原始资料，不写入日志正文。" })
  });
  assert.equal(textResponse.status, 201);

  const linkResponse = await fetch(`${origin}/api/intake/link`, {
    method: "POST",
    headers: tokenHeaders(app, origin, { "Content-Type": "application/json" }),
    body: JSON.stringify({ title: "网页验收文章", url: "https://example.com/article" })
  });
  assert.equal(linkResponse.status, 201);

  const fileResponse = await fetch(
    `${origin}/api/intake/file?name=${encodeURIComponent("../../资料.txt")}&title=${encodeURIComponent("网页验收文件")}`,
    {
      method: "POST",
      headers: tokenHeaders(app, origin, { "Content-Type": "application/octet-stream" }),
      body: Buffer.from("document content", "utf8")
    }
  );
  assert.equal(fileResponse.status, 201);
  const fileRecord = (await fileResponse.json()).record;
  assert.doesNotMatch(fileRecord.sourcePath, /\.\./);
  assert.match(fileRecord.sourcePath, /资料\.txt$/);

  const inboxResponse = await fetch(
    `${origin}/api/inbox?status=pending_review&limit=100`,
    { headers: tokenHeaders(app, origin) }
  );
  const inbox = await inboxResponse.json();
  assert.equal(inboxResponse.status, 200);
  assert.equal(inbox.items.length, 3);
  assert.deepEqual(
    new Set(inbox.items.map((item) => item.type)),
    new Set(["text", "article_link", "document"])
  );

  const logPath = path.join(
    app.config.logsRootPath,
    `aisteph-${new Date().toISOString().slice(0, 10)}.jsonl`
  );
  const logText = await readFile(logPath, "utf8");
  assert.doesNotMatch(logText, /只应写入原始资料/);
  assert.doesNotMatch(logText, /document content/);
});

test("文件上传超过配置限制时返回413且不进入收件箱", async (t) => {
  const { app, origin } = await createTestServer(t, { maxUploadBytes: 4 });
  const response = await fetch(`${origin}/api/intake/file?name=large.txt`, {
    method: "POST",
    headers: tokenHeaders(app, origin, { "Content-Type": "application/octet-stream" }),
    body: Buffer.from("12345", "utf8")
  });
  assert.equal(response.status, 413);

  const inboxResponse = await fetch(`${origin}/api/inbox`, {
    headers: tokenHeaders(app, origin)
  });
  assert.equal((await inboxResponse.json()).items.length, 0);
});

test("服务拒绝绑定到非本机地址", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "aisteph-host-test-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const app = await createAIStephServer({
    workspaceRoot,
    port: 0,
    host: "0.0.0.0"
  });
  await assert.rejects(() => app.start(), /只允许绑定127\.0\.0\.1/);
});
test("录音API枚举设备、启动、查询状态并在停止后返回统一记录", async (t) => {
  const calls = [];
  let state = { state: "idle", lastError: null };
  const recorder = {
    async listDevices() {
      calls.push("devices");
      return [{ name: "API Test Microphone" }];
    },
    status() {
      calls.push("status");
      return state;
    },
    async start(input) {
      calls.push(["start", input]);
      state = {
        state: "recording",
        sessionId: "REC-TEST",
        deviceName: input.deviceName,
        title: input.title,
        startedAt: new Date().toISOString(),
        elapsedSeconds: 0,
        lastError: null
      };
      return state;
    },
    async stop() {
      calls.push("stop");
      state = { state: "idle", lastError: null };
      return {
        id: "SRC-AUDIO-TEST",
        type: "audio",
        status: "pending_review",
        durationSeconds: 3.5
      };
    },
    async shutdown() {
      calls.push("shutdown");
    }
  };
  const { app, origin } = await createTestServer(t, {}, { recorder });

  const devicesResponse = await fetch(`${origin}/api/recorder/devices`, {
    headers: tokenHeaders(app, origin)
  });
  assert.equal(devicesResponse.status, 200);
  assert.deepEqual((await devicesResponse.json()).devices, [{ name: "API Test Microphone" }]);

  const startResponse = await fetch(`${origin}/api/recorder/start`, {
    method: "POST",
    headers: tokenHeaders(app, origin, { "Content-Type": "application/json" }),
    body: JSON.stringify({ deviceName: "API Test Microphone", title: "API录音" })
  });
  assert.equal(startResponse.status, 202);
  assert.equal((await startResponse.json()).state, "recording");

  const statusResponse = await fetch(`${origin}/api/recorder/status`, {
    headers: tokenHeaders(app, origin)
  });
  assert.equal((await statusResponse.json()).sessionId, "REC-TEST");

  const stopResponse = await fetch(`${origin}/api/recorder/stop`, {
    method: "POST",
    headers: tokenHeaders(app, origin)
  });
  assert.equal(stopResponse.status, 201);
  const record = (await stopResponse.json()).record;
  assert.equal(record.type, "audio");
  assert.equal(record.status, "pending_review");
  assert.deepEqual(calls.find((item) => Array.isArray(item)), [
    "start",
    { deviceName: "API Test Microphone", title: "API录音" }
  ]);
});
