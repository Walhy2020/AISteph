import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import { loadConfig } from "../src/core/config.js";
import { createLogger } from "../src/core/logger.js";
import { initializeWorkspace } from "../src/core/workspace.js";
import { addLink, addText, importFile } from "../src/core/intake.js";

async function createTestContext() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "aisteph-test-"));
  const config = await loadConfig(workspaceRoot);
  const log = createLogger(config);
  await initializeWorkspace(config);
  return { workspaceRoot, config, log };
}

test("文字、链接和文件进入统一待审核结构", async (t) => {
  const context = await createTestContext();
  t.after(() => rm(context.workspaceRoot, { recursive: true, force: true }));

  const textRecord = await addText(context.config, context.log, {
    title: "测试想法",
    text: "这是一条不会写入日志正文的测试内容。"
  });
  const linkRecord = await addLink(context.config, context.log, {
    title: "示例文章",
    url: "https://example.com/article"
  });
  const inputPath = path.join(context.workspaceRoot, "sample.txt");
  await writeFile(inputPath, "sample document", "utf8");
  const fileRecord = await importFile(context.config, context.log, { inputPath });

  for (const record of [textRecord, linkRecord, fileRecord]) {
    assert.equal(record.status, "pending_review");
    assert.match(record.contentHash, /^[a-f0-9]{64}$/);
    const note = await readFile(
      path.join(context.workspaceRoot, record.inboxNotePath.slice(2)),
      "utf8"
    );
    assert.match(note, /status: "pending_review"/);
    assert.match(note, /检查是否包含敏感信息/);
  }

  const logPath = path.join(
    context.config.logsRootPath,
    `aisteph-${new Date().toISOString().slice(0, 10)}.jsonl`
  );
  const logText = await readFile(logPath, "utf8");
  assert.doesNotMatch(logText, /不会写入日志正文/);
});

test("拒绝逃逸工作区的配置路径", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "aisteph-config-test-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await mkdir(path.join(workspaceRoot, "config"));
  await writeFile(
    path.join(workspaceRoot, "config", "aisteph.json"),
    JSON.stringify({ dataRoot: "../outside" }),
    "utf8"
  );
  await assert.rejects(() => loadConfig(workspaceRoot), /不能超出项目工作目录/);
});

test("拒绝非 HTTP 的文章链接", async (t) => {
  const context = await createTestContext();
  t.after(() => rm(context.workspaceRoot, { recursive: true, force: true }));
  await assert.rejects(
    () => addLink(context.config, context.log, { url: "file:///secret.txt" }),
    /只允许 http 或 https/
  );
});

test("按配置中的相对目录初始化工作区", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "aisteph-custom-path-test-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await mkdir(path.join(workspaceRoot, "config"));
  await writeFile(
    path.join(workspaceRoot, "config", "aisteph.json"),
    JSON.stringify({
      dataRoot: "./private-data",
      vaultRoot: "./my-vault",
      logsRoot: "./runtime-logs"
    }),
    "utf8"
  );
  const config = await loadConfig(workspaceRoot);
  await initializeWorkspace(config);

  for (const directory of [
    path.join(workspaceRoot, "private-data", "records"),
    path.join(workspaceRoot, "my-vault", "00_Inbox", "Review"),
    path.join(workspaceRoot, "runtime-logs")
  ]) {
    assert.equal((await stat(directory)).isDirectory(), true);
  }
});

test("文件导入拒绝目录路径", async (t) => {
  const context = await createTestContext();
  t.after(() => rm(context.workspaceRoot, { recursive: true, force: true }));
  await assert.rejects(
    () => importFile(context.config, context.log, {
      inputPath: context.workspaceRoot
    }),
    /必须是普通文件/
  );
});
