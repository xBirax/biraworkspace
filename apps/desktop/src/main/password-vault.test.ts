import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PasswordVault } from "./password-vault.js";

const created: string[] = [];

function tempVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-vault-test-"));
  created.push(dir);
  const storage = {
    getSelectedStorageBackend: () => "gnome_libsecret" as const,
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value: Buffer) =>
      value.toString("utf8").replace(/^encrypted:/, ""),
  };
  return {
    file: path.join(dir, "password-vault.v1.json"),
    vault: new PasswordVault(path.join(dir, "password-vault.v1.json"), storage),
  };
}

afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("PasswordVault", () => {
  it("persists only encrypted content and reloads it", () => {
    const { file, vault } = tempVault();
    vault.saveCredential("https://example.com/login", "user@example.com", "secret-value");
    const raw = fs.readFileSync(file, "utf8");
    expect(raw).not.toContain("user@example.com");
    expect(raw).not.toContain("secret-value");

    const reloaded = new PasswordVault(file, {
      getSelectedStorageBackend: () => "gnome_libsecret" as const,
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
      decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
    });
    expect(reloaded.status("https://example.com/other")).toMatchObject({
      total: 1,
      matchCount: 1,
    });
  });

  it("bloqueia o preenchimento em cache quando o chaveiro fica indisponível", () => {
    const { file } = tempVault();
    let available = true;
    const vault = new PasswordVault(file, {
      getSelectedStorageBackend: () => "gnome_libsecret",
      isEncryptionAvailable: () => available,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString(),
    });
    const entry = vault.saveCredential("https://example.com", "fixture", "sintético");
    const before = fs.readFileSync(file);
    available = false;
    expect(() => vault.getForFill(entry.id, "https://example.com")).toThrow(/chaveiro/);
    expect(fs.readFileSync(file)).toEqual(before);
    available = true;
    expect(vault.getForFill(entry.id, "https://example.com")?.username).toBe("fixture");
  });

  it("never returns a credential for a different origin", () => {
    const { vault } = tempVault();
    const saved = vault.saveCredential("https://example.com", "user", "secret");
    expect(vault.getForFill(saved.id, "https://evil.example")).toBeNull();
    expect(vault.getForFill(saved.id, "http://example.com")).toBeNull();
  });

  it("imports and updates Chrome/Brave CSV entries", () => {
    const { vault } = tempVault();
    const first = vault.importCsv(
      "name,url,username,password\nExample,https://example.com/login,user,one\n",
    );
    const second = vault.importCsv(
      "name,url,username,password\nExample,https://example.com/login,user,two\n",
    );
    expect(first).toMatchObject({ imported: 1, updated: 0, total: 1 });
    expect(second).toMatchObject({ imported: 0, updated: 1, total: 1 });
  });

  it("apaga um cofre ilegível (ex.: zerado por queda de energia) em vez de travar", () => {
    const { file, vault } = tempVault();
    vault.saveCredential("https://example.com", "user", "secret");
    fs.writeFileSync(file, Buffer.alloc(64));
    const reopened = new PasswordVault(file, {
      getSelectedStorageBackend: () => "gnome_libsecret" as const,
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
      decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
    });
    expect(() => reopened.status("https://example.com")).toThrow();
    expect(reopened.clear()).toBe(0);
    expect(fs.existsSync(file)).toBe(false);
    expect(reopened.status("https://example.com")).toMatchObject({ total: 0 });
    reopened.saveCredential("https://example.com", "user", "new");
    expect(reopened.status("https://example.com")).toMatchObject({ total: 1 });
  });
});

describe("PasswordVault com o Bitwarden", () => {
  const items = [
    {
      type: 1,
      name: "Site",
      login: {
        username: "ana",
        password: "pw",
        uris: [
          { uri: "https://example.com", match: null },
          { uri: "https://admin.empresa.com", match: 1 },
        ],
      },
    },
  ];

  it("preenche em subdomínio e respeita o match exato, mesmo depois de reabrir", async () => {
    const { bitwardenItemsToEntries } = await import("./password-vault-format.js");
    const { file, vault } = tempVault();
    vault.mirrorBitwarden(bitwardenItemsToEntries(items));
    const reloaded = new PasswordVault(file, {
      getSelectedStorageBackend: () => "gnome_libsecret" as const,
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
      decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
    });
    const [onSub] = reloaded.listForUrl("https://app.example.com/login");
    expect(onSub?.username).toBe("ana");
    expect(reloaded.getForFill(onSub!.id, "https://app.example.com/login")).not.toBeNull();
    expect(reloaded.listForUrl("https://x.admin.empresa.com/")).toEqual([]);
    expect(reloaded.listForUrl("https://admin.empresa.com/")).toHaveLength(1);
  });

  it("nova sincronização sem o item apaga o que veio do Bitwarden e mantém o manual", async () => {
    const { bitwardenItemsToEntries } = await import("./password-vault-format.js");
    const { vault } = tempVault();
    vault.saveCredential("https://manual.example/login", "bia", "pw");
    vault.mirrorBitwarden(bitwardenItemsToEntries(items));
    const result = vault.mirrorBitwarden(bitwardenItemsToEntries([]));
    expect(result).toMatchObject({ removed: 2, total: 1 });
    expect(vault.listForUrl("https://manual.example/")).toHaveLength(1);
  });
});
