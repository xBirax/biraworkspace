import fs from "node:fs";
import path from "node:path";
import type { SafeStorage } from "electron";
import { writeDurableFile } from "@adr/app-state";
import {
  MAX_PASSWORD_CSV_BYTES,
  entryMeta,
  mergeVaultEntries,
  mirrorBitwardenEntries,
  normalizeVaultOrigin,
  parsePasswordCsv,
  vaultOriginMatch,
  type ParsedPasswordCsv,
  type VaultEntry,
  type VaultEntryMeta,
} from "./password-vault-format.js";

type VaultFile = {
  version: 1;
  ciphertext: string;
};

type VaultPayload = {
  version: 1;
  entries: VaultEntry[];
};

export type PasswordCsvPreview = {
  valid: number;
  skipped: number;
  domains: number;
};

export type PasswordImportResult = PasswordCsvPreview & {
  imported: number;
  updated: number;
  total: number;
};

function isVaultEntry(value: unknown): value is VaultEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<VaultEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.origin === "string" &&
    normalizeVaultOrigin(entry.origin) === entry.origin &&
    typeof entry.username === "string" &&
    typeof entry.password === "string" &&
    typeof entry.createdAt === "number" &&
    typeof entry.updatedAt === "number"
  );
}

import {secureStorageAvailable} from "./secure-storage.js";

export class PasswordVault {
  private entries: VaultEntry[] | null = null;

  constructor(
    private readonly filePath: string,
    private readonly storage: Pick<
      SafeStorage,
      "isEncryptionAvailable" | "encryptString" | "decryptString"
    > & Partial<Pick<SafeStorage, "getSelectedStorageBackend">>,
  ) {}

  isAvailable(): boolean {
    return secureStorageAvailable(this.storage);
  }

  private load(): VaultEntry[] {
    if (!this.isAvailable()) {
      this.entries = null;
      throw new Error("Desbloqueie o chaveiro do sistema para acessar o cofre.");
    }
    if (this.entries) return this.entries;
    if (!fs.existsSync(this.filePath)) {
      this.entries = [];
      return this.entries;
    }

    const wrapper = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<VaultFile>;
    if (wrapper.version !== 1 || typeof wrapper.ciphertext !== "string") {
      throw new Error("Formato do cofre não reconhecido");
    }
    const decrypted = this.storage.decryptString(Buffer.from(wrapper.ciphertext, "base64"));
    const payload = JSON.parse(decrypted) as Partial<VaultPayload>;
    if (
      payload.version !== 1 ||
      !Array.isArray(payload.entries) ||
      !payload.entries.every(isVaultEntry)
    ) {
      throw new Error("O conteúdo do cofre está inválido");
    }
    this.entries = payload.entries.map((entry) => ({ ...entry }));
    return this.entries;
  }

  private persist(entries: VaultEntry[]): void {
    if (!this.isAvailable()) {
      throw new Error("A criptografia segura do sistema operacional não está disponível");
    }
    const payload: VaultPayload = { version: 1, entries };
    const encrypted = this.storage.encryptString(JSON.stringify(payload));
    const wrapper: VaultFile = { version: 1, ciphertext: encrypted.toString("base64") };
    const parent = path.dirname(this.filePath);
    fs.mkdirSync(parent, { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    writeDurableFile(temporary, JSON.stringify(wrapper));
    fs.renameSync(temporary, this.filePath);
    this.entries = entries;
  }

  status(currentUrl = ""): {
    available: boolean;
    total: number;
    matchCount: number;
    origin: string | null;
  } {
    const origin = normalizeVaultOrigin(currentUrl);
    if (!this.isAvailable()) return { available: false, total: 0, matchCount: 0, origin };
    const entries = this.load();
    return {
      available: true,
      total: entries.length,
      matchCount: origin
        ? entries.filter((entry) => vaultOriginMatch(entry.origin, currentUrl, entry.exactOrigin) > 0).length
        : 0,
      origin,
    };
  }

  /** Mesma origem primeiro; depois as do site salvo para os subdomínios (vaultOriginMatch). */
  listForUrl(currentUrl: string): VaultEntryMeta[] {
    if (!normalizeVaultOrigin(currentUrl)) return [];
    return this.load()
      .map((entry) => ({ entry, match: vaultOriginMatch(entry.origin, currentUrl, entry.exactOrigin) }))
      .filter(({ match }) => match > 0)
      .sort((a, b) => b.match - a.match)
      .map(({ entry }) => entryMeta(entry));
  }

  getForFill(id: string, currentUrl: string): VaultEntry | null {
    if (!normalizeVaultOrigin(currentUrl)) return null;
    const entry = this.load().find((candidate) => candidate.id === id);
    return entry && vaultOriginMatch(entry.origin, currentUrl, entry.exactOrigin) > 0 ? { ...entry } : null;
  }

  /** Sincronização com o Bitwarden (ver mirrorBitwardenEntries). */
  mirrorBitwarden(incoming: ParsedPasswordCsv): {
    imported: number;
    updated: number;
    removed: number;
    total: number;
  } {
    const result = mirrorBitwardenEntries(this.load(), incoming);
    this.persist(result.entries);
    return {
      imported: result.imported,
      updated: result.updated,
      removed: result.removed,
      total: result.entries.length,
    };
  }

  previewCsv(input: string): PasswordCsvPreview {
    const parsed = parsePasswordCsv(input);
    return {
      valid: parsed.entries.length,
      skipped: parsed.skipped,
      domains: new Set(parsed.entries.map((entry) => entry.origin)).size,
    };
  }

  importCsv(input: string): PasswordImportResult {
    const parsed = parsePasswordCsv(input);
    const merged = mergeVaultEntries(this.load(), parsed);
    this.persist(merged.entries);
    return {
      valid: parsed.entries.length,
      skipped: parsed.skipped,
      domains: new Set(parsed.entries.map((entry) => entry.origin)).size,
      imported: merged.imported,
      updated: merged.updated,
      total: merged.entries.length,
    };
  }

  saveCredential(currentUrl: string, username: string, password: string): VaultEntryMeta {
    const origin = normalizeVaultOrigin(currentUrl);
    const cleanUsername = username.trim();
    if (!origin || !cleanUsername || !password) {
      throw new Error("Site, usuário ou senha inválidos");
    }
    const merged = mergeVaultEntries(this.load(), {
      entries: [{ origin, username: cleanUsername, password }],
      skipped: 0,
    });
    this.persist(merged.entries);
    const saved = merged.entries.find(
      (entry) => entry.origin === origin && entry.username === cleanUsername,
    );
    if (!saved) throw new Error("Não foi possível salvar a credencial");
    return entryMeta(saved);
  }

  remove(id: string): boolean {
    const entries = this.load();
    const next = entries.filter((entry) => entry.id !== id);
    if (next.length === entries.length) return false;
    this.persist(next);
    return true;
  }

  /**
   * Apaga o arquivo em vez de decifrar e regravar: com o cofre ilegível (ex.:
   * zerado por queda de energia) `load()` lança, e "apagar tudo" é justamente a
   * saída que sobra ao usuário.
   */
  clear(): number {
    let count = 0;
    try {
      count = this.load().length;
    } catch {
      // Ilegível: não há o que contar, mas ainda dá para apagar.
    }
    fs.rmSync(this.filePath, { force: true });
    this.entries = null;
    return count;
  }
}

export function readPasswordCsvFile(filePath: string): string {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error("O arquivo selecionado não é um CSV válido");
  if (stat.size > MAX_PASSWORD_CSV_BYTES) {
    throw new Error("O CSV excede o limite de 10 MB");
  }
  return fs.readFileSync(filePath, "utf8");
}
