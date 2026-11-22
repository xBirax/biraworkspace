import fs from "node:fs";
import path from "node:path";

/**
 * `chrome.storage` do desktop mora no localStorage do web.whatsapp.com, que a
 * página também lê e escreve. Duas consequências tratadas aqui: `baseUrl` é
 * sempre o CRM do app (gravado pela página, mandava os links do painel — com
 * telefone e nome — para outro site), e JSON corrompido vira {} em vez de
 * derrubar o carregamento das preferências.
 */
export const chromeShim = (crmBaseUrl: string): string => `(() => {
  if (window.__adrChromeShim) return;
  window.__adrChromeShim = true;

  const FIXED = { baseUrl: ${JSON.stringify(crmBaseUrl)} };
  const readAll = () => {
    try {
      const value = JSON.parse(localStorage.getItem("adrCrmStorage") || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  };
  const storage = {
    async get(keys) {
      const all = { ...readAll(), ...FIXED };
      if (keys == null) return all;
      const list = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys);
      const out = {};
      for (const key of list) out[key] = all[key] ?? (typeof keys === "object" && !Array.isArray(keys) ? keys[key] : undefined);
      return out;
    },
    async set(values) {
      const all = readAll();
      Object.assign(all, values);
      delete all.baseUrl;
      localStorage.setItem("adrCrmStorage", JSON.stringify(all));
    },
    async remove(keys) {
      const all = readAll();
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) delete all[key];
      localStorage.setItem("adrCrmStorage", JSON.stringify(all));
    },
  };

  window.chrome = window.chrome || {};
  window.chrome.runtime = {
    id: "adr-desktop-workspace",
    lastError: undefined,
    sendMessage(message, callback) {
      const type = message?.type === "openOptions" ? "openSettings" : message?.type;
      const payload = { ...(message || {}) };
      delete payload.type;
      if (!window.adrCrm?.invoke) {
        window.chrome.runtime.lastError = { message: "Bridge CRM indisponível." };
        callback?.(undefined);
        return;
      }
      window.adrCrm.invoke(type, payload).then((res) => {
        window.chrome.runtime.lastError = undefined;
        if (res && res.ok === false && res.message && !res.error) {
          res.error = res.message;
        }
        callback?.(res);
      }).catch((err) => {
        window.chrome.runtime.lastError = { message: String(err?.message || err) };
        callback?.(undefined);
      });
    },
  };
  window.chrome.storage = {
    local: storage,
    session: storage,
    managed: { get: async () => ({}) },
  };
})();`;

/**
 * Versão da extensão vinha fixa no caminho ("adr-crm-extension-0.12.5"), em dois
 * arquivos de pacotes diferentes: subir a extensão exigia lembrar dos dois, e
 * esquecer um deles embarcava silenciosamente a versão velha. Aqui a pasta mais
 * nova ganha, e atualizar vira só soltar o diretório em vendor/.
 */
export function resolveVendorExtensionDir(vendorRoot: string): string {
  const dirs = fs
    .readdirSync(vendorRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^adr-crm-extension-\d/.test(e.name))
    .map((e) => e.name)
    .sort((a, b) =>
      a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }),
    );
  const newest = dirs.at(-1);
  if (!newest) throw new Error(`nenhuma extensão CRM em ${vendorRoot}`);
  return path.join(vendorRoot, newest);
}
export function buildExtensionInjection(
  vendorDir: string,
  crmBaseUrl = "https://app.adragencia.com.br",
): string {
  const shared = fs.readFileSync(path.join(vendorDir, "shared.js"), "utf8");
  const waDom = fs.readFileSync(path.join(vendorDir, "wa-dom.js"), "utf8");
  const content = fs.readFileSync(path.join(vendorDir, "content.js"), "utf8");
  const css = fs.readFileSync(path.join(vendorDir, "styles.css"), "utf8");

  const cssInject = `(() => {
    if (document.getElementById("adr-ext-styles")) return;
    const style = document.createElement("style");
    style.id = "adr-ext-styles";
    style.textContent = ${JSON.stringify(css)};
    document.documentElement.appendChild(style);
    const old = document.getElementById("adr-spike-panel");
    if (old) old.remove();
    document.body?.style.removeProperty("margin-right");
  })();`;

  return `(() => {
    if (window.__adrExtensionInjected) return "already";
    window.__adrExtensionInjected = true;
    try {
      ${chromeShim(crmBaseUrl.replace(/\/+$/, ""))}
      ${cssInject}
      ${shared}
      ${waDom}
      ${content}
      return "ok";
    } catch (error) {
      window.__adrExtensionInjected = false;
      return String(error && error.stack ? error.stack : error);
    }
  })();`;
}
