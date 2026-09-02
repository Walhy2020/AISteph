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

test("管理台显示v0.5.2并遵循Notion DESIGN设计系统", async (t) => {
  const { origin } = await createTestServer(t);
  const [response, stylesResponse, scriptResponse, deviceScriptResponse] = await Promise.all([
    fetch(origin),
    fetch(`${origin}/assets/styles.css`),
    fetch(`${origin}/assets/app.js`),
    fetch(`${origin}/assets/device-selection.js`)
  ]);
  const [html, styles, script, deviceScript] = await Promise.all([
    response.text(),
    stylesResponse.text(),
    scriptResponse.text(),
    deviceScriptResponse.text()
  ]);

  assert.equal(response.status, 200);
  assert.equal(stylesResponse.status, 200);
  assert.equal(scriptResponse.status, 200);
  assert.equal(deviceScriptResponse.status, 200);
  assert.match(html, /AISteph v0\.5\.2/);
  assert.match(html, /type="module"/);
  assert.match(html, /class="topbar top-nav"/);
  assert.match(html, /class="recorder-panel hero-band-dark"/);
  assert.match(html, /class="workspace-mockup-card"/);
  assert.match(html, /class="hero-decoration hero-decoration-peach"/);
  assert.match(html, /捕捉每一个想法。/);
  assert.match(html, /录音资料库/);
  assert.match(html, /id="recorder-status"/);
  assert.match(html, /id="recording-list"/);
  assert.match(html, /<audio controls preload="metadata"><\/audio>/);
  assert.match(html, /class="delete-recording-button"/);
  assert.match(html, /id="recording-toggle"/);
  assert.match(html, /id="recorder-settings-toggle"/);
  assert.match(html, /id="recorder-settings-panel"/);
  assert.match(html, /id="recorder-gain"/);
  assert.match(html, /id="recording-waveform"/);
  assert.doesNotMatch(html, /id="recorder-device-label"/);
  assert.doesNotMatch(html, /id="text-form"/);
  assert.doesNotMatch(html, /id="link-form"/);
  assert.doesNotMatch(html, /id="file-form"/);
  assert.doesNotMatch(html, /class="record-id"/);
  assert.doesNotMatch(html, /class="source-path"/);

  assert.match(styles, /--primary: #5645d4/);
  assert.match(styles, /--primary-active: #4534b3/);
  assert.match(styles, /--brand-navy: #0a1530/);
  assert.match(styles, /--surface: #f6f5f4/);
  assert.match(styles, /--link: #0075de/);
  assert.match(styles, /--card-tint-peach: #ffe8d4/);
  assert.match(styles, /--card-tint-mint: #d9f3e1/);
  assert.match(styles, /"Notion Sans"/);
  assert.match(styles, /height: 64px/);
  assert.match(styles, /width: min\(100%, 1280px\)/);
  assert.match(styles, /box-shadow: var\(--workspace-shadow\)/);
  assert.equal((styles.match(/box-shadow:/g) || []).length, 1);
  assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 1023px\)/);
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 767px\)/);
  assert.match(styles, /@media \(max-width: 479px\)/);
  assert.match(styles, /border-radius: 8px/);
  assert.match(styles, /border-radius: 12px/);
  assert.doesNotMatch(styles, /#1c69d4/);
  assert.doesNotMatch(styles, /#1a2129/);
  assert.doesNotMatch(styles, /linear-gradient/);
  assert.doesNotMatch(styles, /backdrop-filter/);
  assert.match(styles, /\.recording-console\.recording \.recording-waveform/);

  assert.match(script, /method: "DELETE"/);
  assert.match(script, /音频文件、处理队列和待审核资料将永久删除/);
  assert.match(script, /WAVEFORM_BAR_COUNT = 43/);
  assert.match(script, /audioLevelDb/);
  assert.match(script, /}, 250\);/);
  assert.match(script, /RECORDER_DEVICE_STORAGE_KEY/);
  assert.match(script, /DEVICE_RETRY_DELAYS_MS/);
  assert.match(script, /DEVICE_MONITOR_INTERVAL_MS = 5000/);
  assert.match(script, /loadRecorderDevices\(\{ silent: true \}\)/);
  assert.match(script, /录音设备已断开，正在等待重新连接/);
  assert.match(deviceScript, /网易虚拟音频设备/);
  assert.match(deviceScript, /HEADSET_DEVICE_PATTERN/);
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
  assert.equal((await status.json()).version, "0.5.2");
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
test("删除录音API要求令牌和同源请求并同步清理关联文件", async (t) => {
  const { app, origin } = await createTestServer(t);
  const sourceId = "SRC-AUDIO-DELETE-API";
  const audioPath = path.join(app.config.dataRootPath, "audio", "2026-09-02", "REC-API.opus");
  const recordPath = path.join(app.config.dataRootPath, "records", `${sourceId}.json`);
  const queuePath = path.join(app.config.dataRootPath, "queue", `${sourceId}.json`);
  const notePath = path.join(app.config.vaultRootPath, "00_Inbox", "Review", `${sourceId}.md`);
  await mkdir(path.dirname(audioPath), { recursive: true });
  await writeFile(audioPath, "temporary API audio", "utf8");
  await writeFile(recordPath, JSON.stringify({
    id: sourceId,
    type: "audio",
    title: "接口删除测试",
    sourcePath: "./data/audio/2026-09-02/REC-API.opus",
    inboxNotePath: `./vault/00_Inbox/Review/${sourceId}.md`
  }), "utf8");
  await writeFile(queuePath, JSON.stringify({ sourceId }), "utf8");
  await writeFile(notePath, "temporary review note", "utf8");

  const unauthorized = await fetch(`${origin}/api/inbox/audio/${sourceId}`, {
    method: "DELETE"
  });
  assert.equal(unauthorized.status, 403);

  const crossOrigin = await fetch(`${origin}/api/inbox/audio/${sourceId}`, {
    method: "DELETE",
    headers: tokenHeaders(app, "https://untrusted.example")
  });
  assert.equal(crossOrigin.status, 403);

  const response = await fetch(`${origin}/api/inbox/audio/${sourceId}`, {
    method: "DELETE",
    headers: tokenHeaders(app, origin)
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true, sourceId });
  for (const filePath of [audioPath, recordPath, queuePath, notePath]) {
    await assert.rejects(readFile(filePath), (error) => error.code === "ENOENT");
  }
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
        gainDb: input.gainDb,
        audioLevelDb: -18.5,
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
    body: JSON.stringify({ deviceName: "API Test Microphone", title: "API录音", gainDb: 9 })
  });
  assert.equal(startResponse.status, 202);
  assert.equal((await startResponse.json()).state, "recording");

  const statusResponse = await fetch(`${origin}/api/recorder/status`, {
    headers: tokenHeaders(app, origin)
  });
  const recorderStatus = await statusResponse.json();
  assert.equal(recorderStatus.sessionId, "REC-TEST");
  assert.equal(recorderStatus.audioLevelDb, -18.5);

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
    { deviceName: "API Test Microphone", title: "API录音", gainDb: 9 }
  ]);
});
