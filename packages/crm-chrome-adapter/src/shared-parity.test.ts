import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as core from "@adr/crm-core";

/**
 * O desktop injeta o `shared.js` do vendor (escrito à mão); a extensão do Chrome
 * sai com o `shared.js` gerado do crm-core. São duas cópias das mesmas regras —
 * a comparação do campo do WhatsApp já foi corrigida em uma e quase ficou
 * velha na outra. Este teste quebra quando elas divergem.
 */
const vendorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../vendor");
const newest = fs
  .readdirSync(vendorRoot, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^adr-crm-extension-\d/.test(e.name))
  .map((e) => e.name)
  .sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }))
  .at(-1)!;

type Utils = Record<string, (...args: unknown[]) => unknown>;
const root: Record<string, unknown> = {};
new Function("globalThis", "window", "self", fs.readFileSync(path.join(vendorRoot, newest, "shared.js"), "utf8"))(
  root,
  root,
  root,
);
const vendor = (root["CRMWAUtils"] || (globalThis as Record<string, unknown>)["CRMWAUtils"]) as Utils;
const built = core as unknown as Utils;

const cases: Record<string, unknown[][]> = {
  isSameComposerText: [
    ["a\n\n\nb", "a\nb"],
    ["olá\n\nhello", "hello"],
    ["a b", "a\nb"],
    ["  x  ", "x"],
  ],
  normalizeComposerText: [["a\r\nb  \n\n"], [" x "], [null]],
  titleParts: [["Ana | Acme"], ["+55 11 9999 | Dola"], ["Ana-Maria Souza"], ["João - Cliente"], [""]],
  isRealName: [["+55 (11) 9999-0000"], ["Ana"], [""]],
  normalizeTitle: [["  Fulano  de Tal "], ["Ação"]],
  normalizeText: [["  Olá   Mundo "]],
  chatKey: [
    [{ id: "5511@c.us" }, "Ana"],
    [{ phone: "5511" }, "Ana"],
    [null, " Ana "],
  ],
};

describe(`shared.js do vendor (${newest}) x crm-core`, () => {
  for (const [name, inputs] of Object.entries(cases)) {
    it(`${name} dá o mesmo resultado`, () => {
      expect(typeof vendor[name]).toBe("function");
      for (const args of inputs) expect(vendor[name]!(...args)).toEqual(built[name]!(...args));
    });
  }
});
