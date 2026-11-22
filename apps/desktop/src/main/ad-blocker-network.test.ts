import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { net } from "electron";
import { AdBlockManager } from "./ad-blocker.js";

vi.mock("electron", () => ({ net: { fetch: vi.fn() } }));

const tempDirs: string[] = [];
afterEach(() => {
  vi.mocked(net.fetch).mockReset();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function manager(): { blocker: AdBlockManager; cachePath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-adblock-network-"));
  tempDirs.push(dir);
  const cachePath = path.join(dir, "network-domains.v1.json");
  return {
    blocker: new AdBlockManager(cachePath, () => true, () => [], () => ""),
    cachePath,
  };
}

describe("ad blocker startup network", () => {
  it("loads filter lists through Electron networking and caches them", async () => {
    vi.mocked(net.fetch)
      .mockResolvedValueOnce(new Response("||ads.example.test^\n") as Awaited<ReturnType<typeof net.fetch>>)
      .mockResolvedValueOnce(new Response("||tracker.example.test^\n") as Awaited<ReturnType<typeof net.fetch>>);
    const { blocker, cachePath } = manager();

    await blocker.initialize();

    expect(net.fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(net.fetch).mock.calls[0]?.[1]).toMatchObject({ credentials: "omit" });
    expect(blocker.stateFor(0, "https://example.test/").filterCount).toBeGreaterThan(14);
    expect(JSON.parse(fs.readFileSync(cachePath, "utf8")).domains).toContain("ads.example.test");
  });

  it("closes a failed response without interrupting startup or replacing the fallback list", async () => {
    const failed = new Response("service unavailable", { status: 503 });
    const cancel = vi.spyOn(failed.body!, "cancel");
    vi.mocked(net.fetch)
      .mockResolvedValueOnce(failed as Awaited<ReturnType<typeof net.fetch>>)
      .mockResolvedValueOnce(new Response("||ads.example.test^\n") as Awaited<ReturnType<typeof net.fetch>>);
    const { blocker, cachePath } = manager();

    await expect(blocker.initialize()).resolves.toBeUndefined();

    expect(cancel).toHaveBeenCalledOnce();
    expect(fs.existsSync(cachePath)).toBe(false);
    expect(blocker.stateFor(0, "https://example.test/").filterCount).toBe(14);
  });
});
