import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";

function dayStamp(date) {
  return date.toISOString().slice(0, 10);
}

export function createLogger(config) {
  return async function log(level, event, details = {}) {
    const now = new Date();
    await mkdir(config.logsRootPath, { recursive: true });
    const entry = {
      timestamp: now.toISOString(),
      level,
      event,
      appVersion: config.version,
      ...details
    };
    const logPath = path.join(config.logsRootPath, `aisteph-${dayStamp(now)}.jsonl`);
    await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  };
}
