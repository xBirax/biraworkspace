import fs from "node:fs";
import path from "node:path";

export type LegacyEntry = {
  kind: "startup" | "reg" | "power" | "hibernate";
  name: string;
  scope: "HKCU" | "HKLM" | "system";
  restoration: "manual" | "unavailable";
  reason: string;
  /** Kept only in the private import. Never included in the exported report. */
  original?: { type: "String" | "DWord"; value: string | number | null };
};
export type LegacyImport = { present: boolean; verified: false; restorationReady: false; entries: LegacyEntry[]; warnings: string[] };

const KNOWN_HKCU = new Set([
  "HKCU:\\Control Panel\\Desktop|MenuShowDelay",
  "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects|VisualFXSetting",
].map((value) => value.toUpperCase()));
const RUN = "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run";

/** The former elevated script wrote its backup after mutations. Treat every entry as unverified. */
export function readLegacyBackup(localAppData = process.env['LOCALAPPDATA']): LegacyImport {
  const empty: LegacyImport = { present: false, verified: false, restorationReady: false, entries: [], warnings: [] };
  if (!localAppData) return empty;
  const file = path.join(localAppData, "ADRBooster", "backup.json");
  let stat: fs.Stats;
  try { stat = fs.lstatSync(file); } catch { return empty; }
  const result: LegacyImport = { present: true, verified: false, restorationReady: false, entries: [], warnings: [] };
  if (!stat.isFile() || stat.size > 1024 * 1024) { result.warnings.push("Backup legado inválido ou grande demais"); return result; }
  let parsed: unknown;
  try { parsed = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
  catch { result.warnings.push("Backup legado ilegível"); return result; }
  const items = (parsed as { Items?: unknown })?.Items;
  if (!Array.isArray(items)) { result.warnings.push("Backup legado sem lista de ações"); return result; }
  const seen = new Set<string>();
  for (const raw of items.slice(0, 1000)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const kind = item['Kind']; const name = item['Name']; const keyPath = item['Path'];
    let entry: LegacyEntry | null = null;
    if (kind === "startup" && typeof name === "string" && typeof keyPath === "string" && name.length > 0 && name.length <= 256) {
      if (keyPath.toUpperCase() === RUN.toUpperCase()) entry = { kind, name, scope: "HKCU", restoration: "manual", reason: "Comando anterior não verificado; restauração automática pendente", ...(typeof item['Command'] === "string" ? { original: { type: "String" as const, value: item['Command'] } } : {}) };
      else entry = { kind, name, scope: "HKLM", restoration: "unavailable", reason: "Entrada de sistema exige restauração assistida" };
    } else if (kind === "reg" && typeof name === "string" && typeof keyPath === "string") {
      const scope = keyPath.toUpperCase().startsWith("HKCU:") ? "HKCU" : "HKLM";
      const known = KNOWN_HKCU.has(`${keyPath}|${name}`.toUpperCase());
      const valueType = item['Type'];
      const old = item['OldValue'];
      const validOriginal = valueType === "String" && (old === null || typeof old === "string")
        ? { type: "String" as const, value: old }
        : valueType === "DWord" && (old === null || (typeof old === "number" && Number.isInteger(old) && old >= 0 && old <= 0xffffffff))
          ? { type: "DWord" as const, value: old } : null;
      entry = { kind, name, scope, restoration: known && validOriginal ? "manual" : "unavailable", reason: known && validOriginal ? "Valor anterior não verificado; restauração automática pendente" : "Registro ou valor fora do conjunto suportado", ...(known && validOriginal ? { original: validOriginal } : {}) };
    } else if (kind === "power" && typeof item['OldGuid'] === "string") {
      entry = { kind, name: "Plano de energia", scope: "system", restoration: "manual", reason: "GUID antigo exige conferência com os planos atuais" };
    } else if (kind === "hibernate") {
      entry = { kind, name: "Hibernação do Windows", scope: "system", restoration: "unavailable", reason: "Exige operação administrativa assistida" };
    }
    if (!entry) continue;
    const identity = `${entry.kind}|${entry.scope}|${entry.name}`.toLowerCase();
    if (seen.has(identity)) { result.warnings.push(`Duplicata legada ignorada: ${entry.kind} ${entry.name}`); continue; }
    seen.add(identity);
    result.entries.push(entry);
  }
  if (items.length > 1000) result.warnings.push("Backup legado truncado em 1000 entradas");
  return result;
}
