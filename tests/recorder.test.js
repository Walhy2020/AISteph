import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import path from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import { loadConfig } from "../src/core/config.js";
import { createLogger } from "../src/core/logger.js";
import { createRecorder, parseDshowDevices } from "../src/core/recorder.js";
import { initializeWorkspace } from "../src/core/workspace.js";

async function createTestContext() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "aisteph-recorder-test-"));
  const config = await loadConfig(workspaceRoot);
  const log = createLogger(config);
  await initializeWorkspace(config);
  return { workspaceRoot, config, log };
}

function createChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    queueMicrotask(() => child.emit("close", null, "SIGTERM"));
    return true;
  };
  return child;
}

function createSpawnHarness({ failStart = false } = {}) {
  const calls = [];
  const spawnImpl = (command, args) => {
    calls.push({ command, args });
    const child = createChild();
    if (args.includes("-list_devices")) {
      child.stdin = null;
      queueMicrotask(() => {
        child.stderr.write('[dshow @ test] "Desk Microphone" (audio)\n');
        child.stderr.write('[dshow @ test] "Camera" (video)\n');
        child.stderr.end();
        child.emit("close", 1, null);
      });
      return child;
    }

    const outputPath = args.at(-1);
    child.stdin = {
      write(value) {
        assert.match(value, /q/);
        writeFileSync(outputPath, Buffer.from("fake opus audio"));
        queueMicrotask(() => child.emit("close", 0, null));
        return true;
      }
    };
    if (failStart) {
      queueMicrotask(() => {
        child.stderr.write("Could not open audio device\n");
        child.stderr.end();
        child.emit("close", 1, null);
      });
    }
    return child;
  };
  return { calls, spawnImpl };
}

test("解析DirectShow输出时只返回去重后的音频设备", () => {
  const output = [
    '[dshow @ one] "Desk Microphone" (audio)',
    '[dshow @ one] "Desk Microphone" (audio)',
    '[dshow @ one] "Web Camera" (video)',
    'Alternative name "@device_cm_123"'
  ].join("\n");
  assert.deepEqual(parseDshowDevices(output), [{ name: "Desk Microphone" }]);
});

test("录音停止后生成Opus音频记录、队列和Obsidian待审核笔记", async (t) => {
  const context = await createTestContext();
  t.after(() => rm(context.workspaceRoot, { recursive: true, force: true }));
  const harness = createSpawnHarness();
  const recorder = createRecorder(context.config, context.log, {
    spawnImpl: harness.spawnImpl,
    startTimeoutMs: 1,
    probeAudio: async (filePath) => {
      assert.equal(existsSync(filePath), true);
      return { codecName: "opus", durationSeconds: 2.345 };
    }
  });

  assert.deepEqual(await recorder.listDevices(), [{ name: "Desk Microphone" }]);
  const started = await recorder.start({
    deviceName: "Desk Microphone",
    title: "录音单元测试"
  });
  assert.equal(started.state, "recording");
  await assert.rejects(
    () => recorder.start({ deviceName: "Desk Microphone" }),
    /已有一场录音/
  );

  const record = await recorder.stop();
  assert.equal(record.type, "audio");
  assert.equal(record.status, "pending_review");
  assert.equal(record.deviceName, "Desk Microphone");
  assert.equal(record.durationSeconds, 2.345);
  assert.match(record.sourcePath, /^\.\/data\/audio\/\d{4}-\d{2}-\d{2}\/REC-.+\.opus$/);
  assert.match(record.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(recorder.status().state, "idle");

  const note = await readFile(
    path.join(context.workspaceRoot, record.inboxNotePath.slice(2)),
    "utf8"
  );
  assert.match(note, /type: "audio"/);
  assert.match(note, /duration_seconds: 2\.345/);
  assert.match(note, /device_name: "Desk Microphone"/);
  assert.equal(
    existsSync(path.join(context.workspaceRoot, record.sourcePath.slice(2))),
    true
  );
});

test("设备不可用和FFmpeg启动失败都不会产生正式收件箱记录", async (t) => {
  const context = await createTestContext();
  t.after(() => rm(context.workspaceRoot, { recursive: true, force: true }));
  const harness = createSpawnHarness({ failStart: true });
  const recorder = createRecorder(context.config, context.log, {
    spawnImpl: harness.spawnImpl,
    startTimeoutMs: 20,
    probeAudio: async () => ({ codecName: "opus", durationSeconds: 1 })
  });

  await assert.rejects(
    () => recorder.start({ deviceName: "Missing Microphone" }),
    /当前不可用/
  );
  await assert.rejects(
    () => recorder.start({ deviceName: "Desk Microphone" }),
    /麦克风启动失败/
  );
  assert.equal(recorder.status().state, "idle");
  assert.match(recorder.status().lastError, /启动失败/);
  assert.deepEqual(await readdir(path.join(context.config.dataRootPath, "records")), []);
});

test("服务退出时主动停止录音并完成入库", async (t) => {
  const context = await createTestContext();
  t.after(() => rm(context.workspaceRoot, { recursive: true, force: true }));
  const harness = createSpawnHarness();
  const clickedAt = new Date("2026-09-01T09:08:55.000Z");
  const recorder = createRecorder(context.config, context.log, {
    spawnImpl: harness.spawnImpl,
    startTimeoutMs: 1,
    now: () => clickedAt,
    probeAudio: async () => ({ codecName: "opus", durationSeconds: 1.25 })
  });

  await recorder.start({ deviceName: "Desk Microphone" });
  await recorder.shutdown();

  assert.equal(recorder.status().state, "idle");
  const recordNames = await readdir(path.join(context.config.dataRootPath, "records"));
  assert.equal(recordNames.length, 1);
  const record = JSON.parse(
    await readFile(path.join(context.config.dataRootPath, "records", recordNames[0]), "utf8")
  );
  assert.equal(record.title, clickedAt.toLocaleString("zh-CN", { hour12: false }));
});