import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getDesktopBootstrapInfo } from "./index.js";
import { CRM_WORLD_ID } from "./main/whatsapp-inject.js";
import {
  CRM_PRELOAD_METHODS,
  desktopCrmCommandSchema,
  validateCrmIpcRequest,
  viewKindAllowsCrmPreload,
} from "@adr/crm-desktop-adapter";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("desktop bootstrap", () => {
  it("exposes product identity and production CRM URL", () => {
    const info = getDesktopBootstrapInfo();
    expect(info.product).toBe("ADR Workspace");
    expect(info.defaultCrmBaseUrl).toBe("https://app.adragencia.com.br");
  });
});

describe("CRM preload isolation", () => {
  it("rejects non-WhatsApp senders", () => {
    const result = validateCrmIpcRequest("whoami", {
      url: "https://example.com",
      frameIsMain: true,
      isWhatsAppInstance: true,
    });
    expect(result.ok).toBe(false);
  });

  it("exposes only typed methods and never attaches to shell/CRM", () => {
    const crmPreload = fs.readFileSync(path.join(root, "src/preload/crm-preload.cjs"), "utf8");
    const shellPreload = fs.readFileSync(path.join(root, "src/shell/shell-preload.cjs"), "utf8");
    const mainSrc = fs.readFileSync(path.join(root, "src/main/workspace-window.ts"), "utf8");

    expect(shellPreload).not.toContain("crm:invoke");
    expect(shellPreload).not.toContain("adrCrm");
    // Mundo isolado, e o mesmo em que o painel é injetado.
    expect(crmPreload).not.toContain("exposeInMainWorld");
    expect(crmPreload).toContain('exposeInIsolatedWorld(CRM_WORLD_ID, "adrCrm"');
    expect(crmPreload).toContain(`const CRM_WORLD_ID = ${CRM_WORLD_ID};`);

    for (const method of CRM_PRELOAD_METHODS) {
      if (method === "invoke") {
        expect(crmPreload).toContain("invoke");
        continue;
      }
      expect(crmPreload).toContain(`${method}:`);
    }
    for (const command of desktopCrmCommandSchema.options) {
      expect(crmPreload).toContain(`"${command}"`);
    }

    expect(viewKindAllowsCrmPreload("whatsapp")).toBe(true);
    expect(viewKindAllowsCrmPreload("crm")).toBe(false);
    expect(viewKindAllowsCrmPreload("shell")).toBe(false);
    expect(mainSrc).toContain('kind: "crm"');
    expect(mainSrc).toContain("../preload/crm-preload.cjs");
    expect(mainSrc).toContain("buildNotificationGuard");
  });

  it("gives other services only the composer translation channel", () => {
    const composerPreload = fs.readFileSync(
      path.join(root, "src/preload/composer-preload.cjs"),
      "utf8",
    );
    const mainSrc = fs.readFileSync(path.join(root, "src/main/workspace-window.ts"), "utf8");

    expect(composerPreload).toContain('ipcRenderer.invoke("composer:translate"');
    expect(composerPreload).not.toContain("crm:invoke");
    expect(composerPreload).not.toContain("adrCrm");
    for (const command of ["lookup", "transcribeMessage", "quickReplies", "openCrm"]) {
      expect(composerPreload).not.toContain(command);
    }
    expect(mainSrc).toContain("../preload/composer-preload.cjs");
  });
});

describe("WhatsApp privacy panel contract", () => {
  it("wires timeout per account and keeps the inline panel script syntactically valid", () => {
    const shellPreload = fs.readFileSync(path.join(root, "src/shell/shell-preload.cjs"), "utf8");
    const panel = fs.readFileSync(path.join(root, "src/shell/panel.html"), "utf8");

    expect(shellPreload).toContain("setWhatsAppLockTimeout: (serviceId, minutes)");
    expect(panel).toContain("setWhatsAppLockTimeout(svc.id, minutes)");
    expect(panel).toContain("Sempre pedir o PIN ao abrir esta aba");
    expect(panel).toContain('dataset.whatsappTimeoutInput = "1"');

    const scripts = [...panel.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) expect(() => new Function(script!)).not.toThrow();
  });
});
