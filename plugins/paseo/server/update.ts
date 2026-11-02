// "Is there a newer GitHistory?" for the plugin banner. Read-only: it asks GitHub and compares versions; applying the
// update is `paseo plugin update githistory`, run by the person on the daemon's machine.
import type { RpcOutput } from "@getpaseo/plugin";
import pkg from "../package.json";
import { RELEASES_API, compareVersions, type Release } from "./core-node/update";
import type { updateRpc } from "../shared/rpc";

export const UPDATE_COMMAND = "paseo plugin update githistory --yes";
// WHY cached: every open client polls; GitHub allows 60 unauthenticated requests an hour per IP.
const TTL_MS = 6 * 60 * 60 * 1000;
let cached: { at: number; release: Release | null } | null = null;

export async function latestRelease(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<Release | null> {
  if (cached && now - cached.at < TTL_MS) return cached.release;
  let release: Release | null = null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetchImpl(RELEASES_API, { headers: { accept: "application/vnd.github+json", "user-agent": "githistory-paseo" }, signal: ctl.signal });
    if (res.ok) release = (await res.json()) as Release;
  } catch {
    /* offline or rate limited: no banner */
  } finally {
    clearTimeout(timer);
  }
  // A failed check is retried after a minute, not after six hours.
  cached = { at: release ? now : now - TTL_MS + 60_000, release };
  return release;
}

export function offer(release: Release | null, current: string): { latest: string | null; url: string | null } {
  if (!release || release.draft || release.prerelease) return { latest: null, url: null };
  const latest = release.tag_name.replace(/^v/i, "");
  return compareVersions(latest, current) > 0 ? { latest, url: release.html_url } : { latest: null, url: null };
}

export async function updateCheck(): Promise<RpcOutput<typeof updateRpc>> {
  const current = pkg.version;
  return { current, ...offer(await latestRelease(), current), command: UPDATE_COMMAND };
}

export const resetUpdateCache = () => {
  cached = null;
};
