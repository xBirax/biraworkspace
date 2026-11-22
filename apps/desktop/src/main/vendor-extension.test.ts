import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { resolveVendorExtensionDir } from "./extension-inject.js";

/**
 * A extensão vem de OUTRO repositório, e aqui ela vive como um fork: a 0.14.1
 * tinha "+ Criar empresa", que nunca existiu no CRM. Subir a versão é um merge,
 * e um merge de arquivo grande cala. No primeiro (0.14.1 → 0.15.0) o CRM tinha
 * apagado `isNomeDeVerdade`; o auto-merge manteve a CHAMADA do fork e o painel
 * teria quebrado em runtime, onde ninguém olha.
 *
 * Estes dois casos são o contrato mínimo entre os dois lados: o que o
 * `whatsapp-inject.ts` procura (`__adrCrmCreateCompanyPath`) tem que existir, e
 * telefone não pode virar nome de gente.
 */
const vendorDir = resolveVendorExtensionDir(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../vendor"),
);

/** Executa a extensão sem DOM: `tick()` desiste sozinho quando não acha conversa. */
function loadCreateCompanyPath(): (phone: string, contact: null, title: string) => string {
  const read = (file: string) => fs.readFileSync(path.join(vendorDir, file), "utf8");
  const el = { closest: () => null, querySelector: () => null, addEventListener() {} };
  const document = {
    querySelector: () => null,
    querySelectorAll: () => [],
    body: el,
    documentElement: el,
    addEventListener() {},
    createElement: () => el,
    getElementById: () => null,
  };
  const window = {
    document,
    MutationObserver: class {
      observe() {}
    },
    requestAnimationFrame: (fn: () => void) => fn(),
    setTimeout: () => 0,
    setInterval: () => 0,
    navigator: { language: "pt-BR" },
    chrome: {
      runtime: { id: "test", sendMessage() {} },
      storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    },
    localStorage: { getItem: () => null, setItem() {} },
  };
  Object.assign(window, { window });
  const run = new Function(
    "window",
    "document",
    "globalThis",
    "MutationObserver",
    "requestAnimationFrame",
    "setTimeout",
    "setInterval",
    "chrome",
    "localStorage",
    "navigator",
    `${read("shared.js")}\n${read("wa-dom.js")}\n${read("content.js")}\nreturn window.__adrCrmCreateCompanyPath;`,
  );
  return run(
    window,
    document,
    window,
    window.MutationObserver,
    window.requestAnimationFrame,
    window.setTimeout,
    window.setInterval,
    window.chrome,
    window.localStorage,
    window.navigator,
  );
}

type Listener = (event: Record<string, unknown>) => void;

/**
 * Sobe a extensão com o mínimo de DOM para o interceptor do envio. O CRMWADom é
 * remendado ANTES de content.js ler `D`: o que se testa é a decisão de engolir ou
 * não o Enter, não os seletores da Meta.
 */
async function loadSendInterceptor(opts: {
  stored?: Record<string, unknown>;
  whoami?: "allowed" | "denied" | "pending";
  identity?: "ok" | "pending";
  translate?: Record<string, unknown>;
  structured?: boolean;
}) {
  const read = (file: string) => fs.readFileSync(path.join(vendorDir, file), "utf8");
  const calls: string[] = [];
  const keydown: Listener[] = [];
  const stub = (): Record<string, unknown> => {
    const el: Record<string, unknown> = {
      style: {},
      dataset: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      setAttribute() {},
      appendChild() {},
      addEventListener() {},
      querySelectorAll: () => [],
      closest: () => null,
    };
    el["querySelector"] = () => el;
    return el;
  };
  const toastEl = stub();
  const dom = {
    composer: {
      innerText: "Olá, tudo bem?",
      isConnected: true,
      getAttribute: () => null,
      contains: () => false,
      querySelector: () => (opts.structured ? {} : null),
    } as Record<string, unknown>,
    clickSend: vi.fn(() => true),
  };
  const document = {
    body: stub(),
    documentElement: stub(),
    querySelector: (sel: string) => (sel === ".crmwa-toast" ? toastEl : null),
    querySelectorAll: () => [],
    createElement: stub,
    addEventListener: (type: string, fn: Listener) => {
      if (type === "keydown") keydown.push(fn);
    },
  };
  const data: Record<string, unknown> = {
    whoami: { hasCrm: true, scope: "s1" },
    getChatIdentity: { chat: { id: "123@c.us" } },
    getTranscriptCache: { items: {} },
    translate: opts.translate ?? { translatedText: "Hi" },
  };
  const chrome = {
    runtime: {
      id: "test",
      sendMessage(msg: { type: string }, cb: (res: unknown) => void) {
        calls.push(msg.type);
        if (msg.type === "whoami" && opts.whoami === "pending") return;
        if (msg.type === "getChatIdentity" && opts.identity === "pending") return;
        const res =
          msg.type === "whoami" && opts.whoami === "denied"
            ? { ok: false, error: "sessão expirada", status: 401 }
            : { ok: true, data: data[msg.type] };
        setTimeout(() => cb(res), 0);
      },
    },
    storage: {
      local: { get: async () => ({ ...opts.stored }), set: async () => {}, remove: async () => {} },
    },
  };
  const patchDom = (D: Record<string, unknown>) =>
    Object.assign(D, {
      isDark: () => false,
      main: () => ({}),
      headerTitle: () => "Fulano",
      composer: () => dom.composer,
      mainComposer: () => dom.composer,
      isSuggestionOpen: () => false,
      activeSendSurface: () => "main",
      footer: () => null,
      clickSend: dom.clickSend,
    });
  const window: Record<string, unknown> = { document, chrome, navigator: { language: "pt-BR" } };
  window["window"] = window;
  new Function(
    "window",
    "document",
    "globalThis",
    "MutationObserver",
    "requestAnimationFrame",
    "setTimeout",
    "setInterval",
    "chrome",
    "navigator",
    "patchDom",
    `${read("shared.js")}\n${read("wa-dom.js")}\npatchDom(window.CRMWADom);\n${read("content.js")}`,
  )(
    window,
    document,
    window,
    class {
      observe() {}
    },
    (fn: () => void) => fn(),
    setTimeout,
    () => 0,
    chrome,
    window["navigator"],
    patchDom,
  );
  // Sonda da conversa respondida (ou pendurada, em `identity: "pending"`).
  await vi.waitFor(() => expect(calls).toContain("getChatIdentity"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const enter = (isTrusted = true) => {
    const event = {
      key: "Enter",
      shiftKey: false,
      isComposing: false,
      isTrusted,
      target: dom.composer,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };
    for (const fn of keydown) fn(event);
    return event;
  };
  return { calls, dom, enter, toast: () => String(toastEl["textContent"] ?? "") };
}

describe("auto-tradução ao enviar falha FECHADA", () => {
  const on = { autoSendByScopeChat: { s1: { "jid:123@c.us": "en" } } };

  it("sem conversa com auto-envio, o Enter segue para o WhatsApp mesmo com o login carregando", async () => {
    const ext = await loadSendInterceptor({ stored: {}, whoami: "pending" });
    expect(ext.enter().preventDefault).not.toHaveBeenCalled();
  });

  it("login carregando: engole o Enter da conversa com auto-envio e pede para aguardar", async () => {
    const ext = await loadSendInterceptor({ stored: on, whoami: "pending" });
    expect(ext.enter().preventDefault).toHaveBeenCalled();
    expect(ext.toast()).toContain("aguarde e envie de novo");
    expect(ext.calls).not.toContain("translate");
  });

  it("sessão caiu: a preferência salva continua valendo", async () => {
    const ext = await loadSendInterceptor({ stored: on, whoami: "denied" });
    expect(ext.enter().preventDefault).toHaveBeenCalled();
    expect(ext.toast()).toContain("entre no CRM");
  });

  it("conversa ainda sem chave (sonda pendente) não envia o original", async () => {
    const ext = await loadSendInterceptor({ stored: on, identity: "pending" });
    expect(ext.enter().preventDefault).toHaveBeenCalled();
    expect(ext.toast()).toContain("aguarde e envie de novo");
  });

  it("composer remontado sob o mesmo título conta como conversa não identificada", async () => {
    const ext = await loadSendInterceptor({ stored: on });
    ext.dom.composer = { ...ext.dom.composer };
    expect(ext.enter().preventDefault).toHaveBeenCalled();
    expect(ext.toast()).toContain("aguarde e envie de novo");
    expect(ext.calls).not.toContain("translate");
  });

  it("resposta sem translatedText não envia; null explícito (já no idioma) envia o original", async () => {
    const missing = await loadSendInterceptor({ stored: on, translate: {} });
    missing.enter();
    await vi.waitFor(() => expect(missing.toast()).toContain("não foi enviada"));
    expect(missing.dom.clickSend).not.toHaveBeenCalled();

    const same = await loadSendInterceptor({ stored: on, translate: { translatedText: null } });
    same.enter();
    await vi.waitFor(() => expect(same.dom.clickSend).toHaveBeenCalledTimes(1));
  });

  it("Enter sintético da página não traduz nem envia", async () => {
    const ext = await loadSendInterceptor({ stored: on });
    expect(ext.enter(false).preventDefault).toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ext.calls).not.toContain("translate");
  });

  it("menção: o 2º Enter do usuário em até 5 s envia sem tradução", async () => {
    const ext = await loadSendInterceptor({ stored: on, structured: true });
    expect(ext.enter().preventDefault).toHaveBeenCalled();
    expect(ext.toast()).toContain("Envie de novo");
    expect(ext.enter().preventDefault).not.toHaveBeenCalled();
    expect(ext.calls).not.toContain("translate");
  });
});

describe(`extensão embutida (${path.basename(vendorDir)})`, () => {
  it("expõe buildCreateCompanyPath para o botão do cabeçalho", () => {
    expect(typeof loadCreateCompanyPath()).toBe("function");
  });

  it("não manda telefone no campo de pessoa", () => {
    const path0 = loadCreateCompanyPath()("5511999999999", null, "+55 11 9999 | Dola");
    const params = new URLSearchParams(path0.split("?")[1]);
    expect(params.get("vincularEmpresaNome")).toBe("Dola");
    expect(params.get("vincularEmpresaContatoNome")).toBeNull();
  });

  it("separa \"Pessoa | Empresa\"", () => {
    const path0 = loadCreateCompanyPath()("5511999999999", null, "Joao | Acme");
    const params = new URLSearchParams(path0.split("?")[1]);
    expect(params.get("vincularEmpresaContatoNome")).toBe("Joao");
    expect(params.get("vincularEmpresaNome")).toBe("Acme");
  });
});
