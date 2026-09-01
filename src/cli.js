#!/usr/bin/env node
import { loadConfig } from "./core/config.js";
import { createLogger } from "./core/logger.js";
import { initializeWorkspace } from "./core/workspace.js";
import { addLink, addText, importFile } from "./core/intake.js";
import { getVersion } from "./version.js";

function parseArguments(args) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { positional, flags };
}

function printHelp(version) {
  console.log(`AISteph v${version}`);
  console.log("");
  console.log("用法:");
  console.log("  node src/cli.js init");
  console.log('  node src/cli.js add-text --title "标题" --text "内容"');
  console.log('  node src/cli.js add-link "https://example.com" --title "标题"');
  console.log('  node src/cli.js import-file ".\\资料.pdf" --title "标题"');
  console.log("  node src/cli.js --version");
}

async function main() {
  const version = await getVersion();
  const { positional, flags } = parseArguments(process.argv.slice(2));
  if (flags.version || positional[0] === "version") {
    console.log(`AISteph v${version}`);
    return;
  }
  if (flags.help || positional.length === 0) {
    printHelp(version);
    return;
  }

  const workspaceRoot = process.cwd();
  const config = await loadConfig(workspaceRoot);
  config.version = version;
  const log = createLogger(config);
  const startedAt = Date.now();
  const command = positional[0];

  try {
    await initializeWorkspace(config);
    let result;
    if (command === "init") {
      await log("info", "workspace.initialized", { durationMs: Date.now() - startedAt });
      console.log(`AISteph v${version} 工作区初始化完成`);
      return;
    }
    if (command === "add-text") {
      result = await addText(config, log, { title: flags.title, text: flags.text });
    } else if (command === "add-link") {
      result = await addLink(config, log, { title: flags.title, url: positional[1] });
    } else if (command === "import-file") {
      result = await importFile(config, log, { title: flags.title, inputPath: positional[1] });
    } else {
      throw new Error(`未知命令: ${command}`);
    }

    await log("info", "command.completed", {
      command,
      sourceId: result.id,
      durationMs: Date.now() - startedAt
    });
    console.log(`AISteph v${version} 收录完成: ${result.id}`);
    console.log(`待审核笔记: ${result.inboxNotePath}`);
  } catch (error) {
    await log("error", "command.failed", {
      command,
      durationMs: Date.now() - startedAt,
      errorName: error.name,
      errorMessage: error.message
    }).catch(() => {});
    console.error(`AISteph v${version} 执行失败: ${error.message}`);
    process.exitCode = 1;
  }
}

await main();
