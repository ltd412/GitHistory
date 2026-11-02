// The update banner: a newer published release is offered, an equal/older/draft/failed one is not, and GitHub is asked once per TTL.
import assert from "node:assert/strict";
import { test } from "node:test";
import { latestRelease, offer, resetUpdateCache } from "../server/update";

const rel = (tag: string, extra = {}) => ({ tag_name: tag, html_url: `https://github.com/ltd412/GitHistory/releases/tag/${tag}`, assets: [], ...extra });

test("offer: only a strictly newer, published release", () => {
  assert.equal(offer(rel("v0.3.0"), "0.2.1").latest, "0.3.0");
  assert.equal(offer(rel("v0.2.1"), "0.2.1").latest, null);
  assert.equal(offer(rel("v0.2.0"), "0.2.1").latest, null);
  assert.equal(offer(rel("v0.3.0", { draft: true }), "0.2.1").latest, null);
  assert.equal(offer(rel("v0.3.0", { prerelease: true }), "0.2.1").latest, null);
  assert.equal(offer(null, "0.2.1").latest, null);
});

test("latestRelease caches a success, retries a failure sooner", async () => {
  resetUpdateCache();
  let calls = 0;
  const ok = (async () => (calls++, { ok: true, json: async () => rel("v0.3.0") })) as unknown as typeof fetch;
  assert.equal((await latestRelease(ok, 1_000))?.tag_name, "v0.3.0");
  await latestRelease(ok, 2_000);
  assert.equal(calls, 1, "cached");
  resetUpdateCache();
  const bad = (async () => {
    calls++;
    throw new Error("offline");
  }) as unknown as typeof fetch;
  assert.equal(await latestRelease(bad, 1_000), null);
  await latestRelease(bad, 30_000);
  assert.equal(calls, 2, "failure cached for a minute");
  await latestRelease(bad, 70_000);
  assert.equal(calls, 3, "then retried");
  resetUpdateCache();
});
