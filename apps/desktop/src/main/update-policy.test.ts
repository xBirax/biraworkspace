import { describe, expect, it } from "vitest";
import { canInstallUpdateNow, compareVersions, pickLinuxAsset, shouldCheckForUpdatesAt } from "./update-policy.js";

describe("compareVersions", () => {
  it("orders semver-ish tags", () => {
    expect(compareVersions("0.2.0", "0.1.0-spike")).toBe(1);
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("v1.0.0", "1.0.1")).toBe(-1);
  });

  it("treats a prerelease as older than the final of the same version", () => {
    // Era o buraco: parseInt("0-spike") = 0, então isto empatava e quem estava
    // na prerelease nunca via o release final.
    expect(compareVersions("0.1.0", "0.1.0-spike")).toBe(1);
    expect(compareVersions("0.1.0-spike", "0.1.0")).toBe(-1);
    expect(compareVersions("0.1.0-spike", "0.1.0-spike")).toBe(0);
    expect(compareVersions("0.1.0-beta", "0.1.0-spike")).toBe(-1);
  });
});

describe("pickLinuxAsset", () => {
  it("prefers deb", () => {
    const url = pickLinuxAsset(
      [
        { name: "adr.AppImage", browser_download_url: "https://x/a" },
        { name: "adr_amd64.deb", browser_download_url: "https://x/d" },
      ],
      "deb",
    );
    expect(url).toBe("https://x/d");
  });
});

describe("shouldCheckForUpdatesAt", () => {
  it("respects 24h interval", () => {
    expect(shouldCheckForUpdatesAt(undefined, 1000)).toBe(true);
    expect(shouldCheckForUpdatesAt(1000, 1000 + 1000)).toBe(false);
    expect(shouldCheckForUpdatesAt(1000, 1000 + 25 * 60 * 60 * 1000)).toBe(true);
  });
});

describe("canInstallUpdateNow", () => {
  const now = 10 * 60_000;
  const calm = { systemIdleSeconds: 600, now, lastAudibleAt: 0, audibleNow: false, inMeetCall: false, downloading: false };
  it("instala com o computador parado e nada em andamento", () => {
    expect(canInstallUpdateNow(calm)).toBe(true);
  });
  it("silêncio no instante do tick não basta: houve som há menos de 5 min (chamada ouvindo)", () => {
    expect(canInstallUpdateNow({ ...calm, lastAudibleAt: now - 60_000 })).toBe(false);
  });
  it("espera usuário ativo, som, reunião do Meet ou download", () => {
    expect(canInstallUpdateNow({ ...calm, systemIdleSeconds: 120 })).toBe(false);
    expect(canInstallUpdateNow({ ...calm, audibleNow: true })).toBe(false);
    expect(canInstallUpdateNow({ ...calm, inMeetCall: true })).toBe(false);
    expect(canInstallUpdateNow({ ...calm, downloading: true })).toBe(false);
  });
});
