import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

const FILE_NAME = "recorder-preferences.json";

function normalizeGainDb(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(24, Math.max(0, Math.round(numeric)));
}

function normalizePreferences(value = {}) {
  return {
    deviceName: String(value.deviceName ?? "").trim().slice(0, 300),
    gainDb: normalizeGainDb(value.gainDb)
  };
}

export async function createRecorderPreferences(config) {
  const filePath = path.join(config.dataRootPath, FILE_NAME);
  let current = normalizePreferences();
  try {
    current = normalizePreferences(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  return {
    get() {
      return { ...current };
    },
    async update(value) {
      current = normalizePreferences({ ...current, ...value });
      await mkdir(config.dataRootPath, { recursive: true });
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
      await rename(temporaryPath, filePath);
      return { ...current };
    }
  };
}