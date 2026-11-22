import { describe, expect, it, vi } from "vitest";
import { isCrmHandoffPath, isCrmPagePath, SAVE_CONTACT_BUTTON } from "./whatsapp-inject.js";

describe("isCrmPagePath", () => {
  const crm = "https://app.adragencia.com.br";
  it("aceita as telas que o painel linka", () => {
    for (const path of ["/contatos/12", "/empresas?search=ACME", "/negocios?createDealFrom=x", "/negocios/7"]) {
      expect(isCrmPagePath(crm + path)).toBe(true);
    }
  });
  it("recusa API, admin, sair e caminhos aninhados", () => {
    for (const path of ["/api/crm/contacts", "/admin", "/logout", "/contatos/12/excluir", "/"]) {
      expect(isCrmPagePath(crm + path)).toBe(false);
    }
  });
});

describe("isCrmHandoffPath", () => {
  it("aceita só os handoffs de vínculo que os botões e a extensão montam", () => {
    expect(isCrmHandoffPath("/negocios?vincularTelefone=5511999&vincularNome=Jo%C3%A3o")).toBe(true);
    expect(
      isCrmHandoffPath(
        "/negocios?vincularEmpresaNome=Acme&vincularEmpresaContatoNome=Jo&vincularEmpresaTelefone=1&vincularEmpresaContatoId=c1",
      ),
    ).toBe(true);
    expect(isCrmHandoffPath("/negocios?")).toBe(true);
  });

  it("recusa outras rotas, parâmetros e origens escolhidos pela página", () => {
    expect(isCrmHandoffPath("/admin")).toBe(false);
    expect(isCrmHandoffPath("/api/crm/contacts?limit=1")).toBe(false);
    expect(isCrmHandoffPath("/negocios?vincularTelefone=1&delete=1")).toBe(false);
    expect(isCrmHandoffPath("/negocios/../admin?vincularTelefone=1")).toBe(false);
    expect(isCrmHandoffPath("//evil.example/negocios")).toBe(false);
    expect(isCrmHandoffPath("https://evil.example/negocios")).toBe(false);
    expect(isCrmHandoffPath("/negocios#x")).toBe(false);
  });
});

describe("script injetado no cabeçalho do WhatsApp", () => {
  // `new Function` faz o parse sem executar: é o único jeito de um erro de
  // sintaxe nesta string aparecer antes de a injeção falhar silenciosamente.
  it("é JavaScript válido", () => {
    expect(() => new Function(SAVE_CONTACT_BUTTON)).not.toThrow();
  });

  it("usa a montagem compartilhada de URL do content.js", () => {
    expect(SAVE_CONTACT_BUTTON).toContain("window.__adrCrmCreateCompanyPath");
  });

  // DOM falso mínimo: só o que o script usa no cabeçalho do painel do CRM.
  type FakeEvent = { isTrusted: boolean; target?: unknown; key?: string; stopPropagation?: () => void };
  type FakeEl = {
    className: string;
    style: Record<string, string>;
    textContent: string;
    children: FakeEl[];
    listeners: Record<string, Array<(event: FakeEvent) => unknown>>;
    focused: boolean;
    setAttribute: (name: string, value: string) => void;
    addEventListener: (type: string, fn: (event: FakeEvent) => unknown) => void;
    append: (...nodes: FakeEl[]) => void;
    appendChild: (node: FakeEl) => FakeEl;
    focus: () => void;
    contains: (node: unknown) => boolean;
  };

  function fakePage(bridge: Record<string, unknown>) {
    const created: FakeEl[] = [];
    const makeEl = (): FakeEl => {
      const style: Record<string, string> = {};
      // cssText "display:none;…" vira style.display, como no DOM de verdade.
      Object.defineProperty(style, "cssText", {
        set(value: string) {
          const display = /(?:^|;)\s*display:\s*([^;]+)/.exec(value);
          if (display) style["display"] = display[1]!.trim();
        },
      });
      const el: FakeEl = {
        className: "",
        style,
        textContent: "",
        children: [],
        listeners: {},
        focused: false,
        setAttribute: () => undefined,
        addEventListener: (type, fn) => {
          (el.listeners[type] ??= []).push(fn);
        },
        append: (...nodes) => void el.children.push(...nodes),
        appendChild: (node) => {
          el.children.push(node);
          return node;
        },
        focus: () => {
          el.focused = true;
        },
        contains: (node) => node === el || el.children.some((child) => child.contains(node)),
      };
      created.push(el);
      return el;
    };
    const inserted: FakeEl[] = [];
    const findIn = (nodes: FakeEl[], cls: string): FakeEl | null => {
      for (const node of nodes) {
        if (node.className.split(" ").includes(cls)) return node;
        const inner = findIn(node.children, cls);
        if (inner) return inner;
      }
      return null;
    };
    const head = {
      querySelector: (sel: string) => (sel === ".crmwa-x" ? {} : findIn(inserted, sel.slice(1))),
      insertBefore: (el: FakeEl) => void inserted.push(el),
    };
    const timers: Array<() => void> = [];
    let tick: (() => void) | null = null;
    const window: Record<string, unknown> = { adrCrm: bridge };
    const run = () =>
      new Function("window", "document", "setInterval", "setTimeout", `return ${SAVE_CONTACT_BUTTON}`)(
        window,
        { querySelector: () => head, querySelectorAll: () => [], createElement: makeEl, addEventListener: () => undefined },
        (fn: () => void) => {
          tick = fn;
          return 0;
        },
        (fn: () => void) => {
          timers.push(fn);
          return 0;
        },
      ) as string;
    const byClass = (cls: string) => created.filter((el) => el.className.split(" ").includes(cls));
    const fire = (el: FakeEl, type: string, event: FakeEvent) =>
      Promise.all((el.listeners[type] ?? []).map((fn) => fn({ target: el, ...event })));
    return { run, byClass, fire, timers, tick: () => tick?.(), created };
  }

  const bridge = () => ({
    getChatIdentity: vi.fn(async () => ({ data: { chat: { name: "Ana", phone: "5511999999999" } } })),
    saveGoogleContact: vi.fn(async () => ({ ok: true })),
    openCrm: vi.fn(async () => {}),
    scheduleMeeting: vi.fn(async () => ({ ok: true })),
  });

  // A página do WhatsApp alcança os botões pelo DOM: `.click()` dela chega com
  // isTrusted=false e não pode salvar contato, abrir o CRM nem agendar.
  it("ignora clique sintético da página em todos os botões", async () => {
    const adrCrm = bridge();
    const page = fakePage(adrCrm);
    expect(page.run()).toBe("ok");
    const actions = ["adr-save-contact", "adr-link-deal", "adr-schedule-meeting", "adr-link-company"].map(
      (cls) => page.byClass(cls)[0]!,
    );
    // "Salvar no Google" à vista; os outros dentro do menu "Mais".
    const list = page.byClass("adr-more-list")[0]!;
    expect(list.children.map((el) => el.className)).toEqual([
      "crmwa-btn adr-link-deal",
      "crmwa-btn adr-schedule-meeting",
      "crmwa-btn adr-link-company",
    ]);

    for (const el of actions) await page.fire(el, "click", { isTrusted: false });
    expect(adrCrm.getChatIdentity).not.toHaveBeenCalled();

    for (const el of actions) await page.fire(el, "click", { isTrusted: true });
    expect(adrCrm.saveGoogleContact).toHaveBeenCalledTimes(1);
    expect(adrCrm.openCrm).toHaveBeenCalledTimes(2);
    expect(adrCrm.scheduleMeeting).toHaveBeenCalledWith({ name: "Ana", phone: "5511999999999" });
  });

  it("menu 'Mais': clique sintético não abre; Esc fecha e devolve o foco; escolher fecha logo depois", async () => {
    const page = fakePage(bridge());
    page.run();
    const toggle = page.byClass("adr-more-toggle")[0]!;
    const list = page.byClass("adr-more-list")[0]!;
    const wrap = page.byClass("adr-more")[0]!;
    expect(list.style["display"]).toBe("none");

    await page.fire(toggle, "click", { isTrusted: false });
    expect(list.style["display"]).toBe("none");
    await page.fire(toggle, "click", { isTrusted: true });
    expect(list.style["display"]).toBe("flex");

    await page.fire(wrap, "keydown", { isTrusted: true, key: "Escape", stopPropagation: () => undefined });
    expect(list.style["display"]).toBe("none");
    expect(toggle.focused).toBe(true);

    await page.fire(toggle, "click", { isTrusted: true });
    page.timers.length = 0;
    await page.fire(list, "click", { isTrusted: true, target: list.children[0] });
    expect(page.timers).toHaveLength(1);
    page.timers[0]!();
    expect(list.style["display"]).toBe("none");
  });

  it("reinserir a cada 2 s não duplica botões, e a segunda injeção não roda de novo", () => {
    const page = fakePage(bridge());
    page.run();
    const before = page.created.length;
    page.tick();
    page.tick();
    expect(page.created.length).toBe(before);
    expect(page.run()).toBe("already");
  });

  it("sem agendamento na ponte (CRM antigo), o menu fica só com os vínculos", () => {
    const { scheduleMeeting: _omit, ...older } = bridge();
    const page = fakePage(older);
    page.run();
    expect(page.byClass("adr-schedule-meeting")).toHaveLength(0);
    expect(page.byClass("adr-more-list")[0]!.children).toHaveLength(2);
  });
});
