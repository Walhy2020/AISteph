import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { getVersion } from "../src/version.js";

test("版本号在运行时、package和默认配置中保持一致", async () => {
  const version = await getVersion();
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );

  assert.equal(version, "0.5.0");
  assert.equal(packageJson.version, version);
  assert.equal(DEFAULT_CONFIG.version, version);
});
