import { readFile } from "node:fs/promises";

export async function getVersion() {
  return (await readFile(new URL("../VERSION", import.meta.url), "utf8")).trim();
}
