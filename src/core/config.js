import path from "node:path";
import { readFile } from "node:fs/promises";

export const DEFAULT_CONFIG = Object.freeze({
  version: "0.1.0",
  dataRoot: "./data",
  vaultRoot: "./vault",
  logsRoot: "./logs",
  defaultVisibility: "private",
  rawAudioRetentionHours: 72
});

function resolveWorkspacePath(workspaceRoot, configuredPath, fieldName) {
  if (typeof configuredPath !== "string" || configuredPath.trim() === "") {
    throw new Error(`${fieldName} 必须是非空相对路径`);
  }
  if (path.isAbsolute(configuredPath)) {
    throw new Error(`${fieldName} 不能使用绝对路径`);
  }

  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, configuredPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${fieldName} 不能超出项目工作目录`);
  }
  return resolved;
}

export async function loadConfig(workspaceRoot) {
  const configPath = path.join(workspaceRoot, "config", "aisteph.json");
  let custom = {};
  try {
    custom = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(`配置读取失败: ${error.message}`);
    }
  }

  const config = { ...DEFAULT_CONFIG, ...custom };
  return {
    ...config,
    workspaceRoot: path.resolve(workspaceRoot),
    dataRootPath: resolveWorkspacePath(workspaceRoot, config.dataRoot, "dataRoot"),
    vaultRootPath: resolveWorkspacePath(workspaceRoot, config.vaultRoot, "vaultRoot"),
    logsRootPath: resolveWorkspacePath(workspaceRoot, config.logsRoot, "logsRoot")
  };
}
