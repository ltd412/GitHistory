// Persisted project tabs of the Git screen (dinh-chinh-03): one small JSON file in the daemon's home.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { tabsRpc, TabsState } from "../shared/rpc";

const EMPTY: TabsState = { tabs: [], active: null };

const paseoHome = (env: NodeJS.ProcessEnv) =>
  env.PASEO_HOME ? env.PASEO_HOME.replace(/^~(?=$|\/)/, os.homedir()) : path.join(os.homedir(), ".paseo");

export function tabsFile(env = process.env): string {
  return path.join(paseoHome(env), "plugin-data", "githistory", "tabs.json");
}

/** Where tabs lived while the plugin id was `gitkrane` (renamed to `githistory`, dinh-chinh-04). */
export function legacyTabsFile(env = process.env): string {
  return path.join(paseoHome(env), "plugin-data", "gitkrane", "tabs.json");
}

export function readTabs(file = tabsFile(), legacy = legacyTabsFile()): TabsState {
  // Until the first save under the new id, keep the tabs saved under the old one.
  if (!fs.existsSync(file) && fs.existsSync(legacy)) file = legacy;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw?.version === 1 && Array.isArray(raw.tabs)) return { tabs: raw.tabs, active: raw.active ?? null };
  } catch {
    // Missing or unreadable: start with no saved tabs.
  }
  return EMPTY;
}

/** Written to a temp file and renamed, so a crash mid-write never leaves a half file behind. */
export function writeTabs(state: TabsState, file = tabsFile()): TabsState {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, ...state }, null, 2));
  fs.renameSync(tmp, file);
  return state;
}

export async function tabs(input: RpcInput<typeof tabsRpc>): Promise<RpcOutput<typeof tabsRpc>> {
  return input.action === "get" ? readTabs() : writeTabs(input.state);
}
