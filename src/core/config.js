import path from "node:path";
import { readFile } from "node:fs/promises";

export const DEFAULT_CONFIG = Object.freeze({
  version: "0.2.0",
  dataRoot: "./data",
  vaultRoot: "./vault",
  logsRoot: "./logs",
  defaultVisibility: "private",
  rawAudioRetentionHours: 72,
  serverPort: 39310,
  maxUploadBytes: 104857600
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
  if (!Number.isInteger(config.serverPort) || config.serverPort < 1024 || config.serverPort > 65535) {
    throw new Error("serverPort 必须是 1024 到 65535 之间的整数");
  }
  if (!Number.isInteger(config.maxUploadBytes) || config.maxUploadBytes < 1) {
    throw new Error("maxUploadBytes 必须是正整数");
  }
  return {
    ...config,
    workspaceRoot: path.resolve(workspaceRoot),
    dataRootPath: resolveWorkspacePath(workspaceRoot, config.dataRoot, "dataRoot"),
    vaultRootPath: resolveWorkspacePath(workspaceRoot, config.vaultRoot, "vaultRoot"),
    logsRootPath: resolveWorkspacePath(workspaceRoot, config.logsRoot, "logsRoot")
  };
}
