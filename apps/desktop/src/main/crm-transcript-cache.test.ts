import { describe, expect, it, vi } from "vitest";
import { CrmTranscriptCache } from "./crm-transcript-cache.js";

describe("authenticated transcript cache", () => {
  it("rejects cross-workspace reads and writes with renderer-controlled scopes", async () => {
    const cache = new CrmTranscriptCache(async (workspace) => ({
      hasCrm: true,
      scope: `tenant:${workspace}`,
    }));
    await cache.write("B", "tenant:B", "msg", "private B");
    await expect(cache.read("A", "tenant:B")).rejects.toMatchObject({ status: 403 });
    await expect(cache.write("A", "tenant:B", "msg", "poison")).rejects.toMatchObject({
      status: 403,
    });
    expect((await cache.read("B", "tenant:B")).items["msg"]?.text).toBe("private B");
  });

  it("keeps workspaces separate even when the same user logs into both", async () => {
    const cache = new CrmTranscriptCache(async () => ({ hasCrm: true, scope: "tenant:user" }));
    await cache.write("A", "tenant:user", "msg", "A only");
    expect((await cache.read("B", "tenant:user")).items).toEqual({});
  });

  it("revalidates cache hits and drops data after logout and identity changes", async () => {
    const authorize = vi.fn(async () => ({ hasCrm: true, scope: "tenant:old" }));
    const cache = new CrmTranscriptCache(authorize);
    await cache.write("A", "tenant:old", "msg", "private");
    authorize.mockResolvedValueOnce({ hasCrm: false, scope: "" });
    await expect(cache.read("A", "tenant:old")).rejects.toMatchObject({ status: 403 });
    expect((await cache.read("A", "tenant:old")).items).toEqual({});
    await cache.write("A", "tenant:old", "msg", "old");
    authorize.mockResolvedValue({ hasCrm: true, scope: "tenant:new" });
    expect((await cache.read("A", "tenant:new")).items).toEqual({});
    expect(authorize).toHaveBeenCalledTimes(5);
  });

  it("does not resurrect data when logout happens during authorization", async () => {
    let finish!: (value: { hasCrm: boolean; scope: string }) => void;
    const cache = new CrmTranscriptCache(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const write = cache.write("A", "tenant:user", "msg", "stale");
    cache.invalidate("A");
    finish({ hasCrm: true, scope: "tenant:user" });
    await expect(write).rejects.toMatchObject({ status: 403 });
  });
});
