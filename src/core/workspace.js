import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const DATA_DIRECTORIES = [
  ["records"],
  ["queue"],
  ["sources", "text"],
  ["sources", "articles"],
  ["sources", "documents"]
];

const VAULT_DIRECTORIES = [
  ["00_Inbox", "Review"],
  ["10_Daily"],
  ["20_Sources", "Conversations"],
  ["20_Sources", "Articles"],
  ["20_Sources", "Documents"],
  ["30_Knowledge"],
  ["40_Projects"],
  ["50_People"],
  ["60_Decisions"],
  ["70_SOP"],
  ["80_QA"],
  ["90_Archive"]
];

export async function initializeWorkspace(config) {
  for (const parts of DATA_DIRECTORIES) {
    await mkdir(path.join(config.dataRootPath, ...parts), { recursive: true });
  }
  for (const parts of VAULT_DIRECTORIES) {
    await mkdir(path.join(config.vaultRootPath, ...parts), { recursive: true });
  }
  await mkdir(config.logsRootPath, { recursive: true });

  const localConfigPath = path.join(config.workspaceRoot, "config", "aisteph.json");
  await mkdir(path.dirname(localConfigPath), { recursive: true });
  const localConfig = {
    version: config.version,
    dataRoot: config.dataRoot,
    vaultRoot: config.vaultRoot,
    logsRoot: config.logsRoot,
    defaultVisibility: config.defaultVisibility,
    rawAudioRetentionHours: config.rawAudioRetentionHours
  };
  await writeFile(localConfigPath, `${JSON.stringify(localConfig, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx"
  }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
}
