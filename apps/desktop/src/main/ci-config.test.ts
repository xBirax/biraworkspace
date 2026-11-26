import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Linux packaging CI regression", () => {
  it.each(["\n", "\r\n"])(
    "accepts release tags and prepares a clean checkout with %j line endings",
    (lineEnding) => {
      const workflow = fs
        .readFileSync(new URL("../../../../.github/workflows/ci.yml.disabled", import.meta.url), "utf8")
        .replace(/\r?\n/g, lineEnding);
      const triggers = workflow.split("concurrency:")[0]!;
      expect(triggers).toMatch(/push:\s*\n\s+branches:.*\r?\n\s+tags:\s*\["v\*"\]/);
      const pack = workflow.split("\n  pack:")[1]!;
      expect(pack).toContain("if: startsWith(github.ref, 'refs/tags/')");
      const commands = [...pack.matchAll(/- run: (.+)/g)].map((match) => match[1]);
      expect(commands).toEqual([
        "pnpm install --frozen-lockfile",
        "pnpm build",
        "pnpm ensure:electron",
        "pnpm --filter @adr/desktop run pack:linux --publish never",
        "node scripts/release-artifacts.mjs",
      ]);
    },
  );
});


describe("Windows release candidates", () => {
  it("checks the core package version and keeps rc tags out of the stable channel", () => {
    const workflow = fs.readFileSync(
      new URL("../../../../.github/workflows/release-windows.yml.disabled", import.meta.url),
      "utf8",
    );
    expect(workflow).toContain("$coreVersion = $tagVersion -replace '-rc\\.\\d+$', ''");
    expect(workflow).toContain("contains(github.ref_name, '-rc.')");
    expect(workflow).toContain("--prerelease");
    expect(workflow).toContain("name: Publicar atualização estável");
    expect(workflow).toContain("!contains(github.ref_name, '-rc.')");
    const desktopPackage = JSON.parse(
      fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { build?: { publish?: Array<{ releaseType?: string }> } };
    expect(desktopPackage.build?.publish).toEqual([]);
    expect(fs.readdirSync(new URL("../../../../.github/workflows/", import.meta.url)).filter(name => /\.ya?ml$/.test(name))).toEqual([]);
  });
});
