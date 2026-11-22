import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Sem jsdom no projeto (mesma regra de notifications.test.ts): montamos à mão só o que
// wa-dom.js realmente usa. O que este teste protege é a NOVA lógica de achar a legenda
// do anexo — não os seletores da Meta, que só o WhatsApp real valida.
type Kind = "editable" | "send" | "plain";

type FakeNode = {
  kind: Kind;
  marks: string[];
  label: string;
  isConnected: boolean;
  parentElement: FakeNode | null;
  children: FakeNode[];
  getAttribute(name: string): string | null;
  getBoundingClientRect(): { width: number; height: number };
  closest(sel: string): FakeNode | null;
  querySelectorAll(sel: string): FakeNode[];
};

const descendants = (root: FakeNode): FakeNode[] =>
  root.children.flatMap((child) => [child, ...descendants(child)]);

// wa-dom.js só consulta duas formas de seletor: o contenteditable e a setinha de enviar.
const matches = (node: FakeNode, sel: string): boolean =>
  sel.includes("contenteditable") ? node.kind === "editable" : node.kind === "send";

const node = (
  kind: Kind,
  opts: { marks?: string[]; label?: string; children?: FakeNode[] } = {},
): FakeNode => {
  const self: FakeNode = {
    kind,
    marks: opts.marks ?? [],
    label: opts.label ?? "",
    isConnected: true,
    parentElement: null,
    children: opts.children ?? [],
    getAttribute: (name) => (name === "aria-label" ? self.label || null : null),
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    closest: (sel) => {
      for (let n: FakeNode | null = self; n; n = n.parentElement) {
        if (n.marks.includes(sel)) return n;
      }
      return null;
    },
    querySelectorAll: (sel) => descendants(self).filter((n) => matches(n, sel)),
  };
  for (const child of self.children) child.parentElement = self;
  return self;
};

const sendButton = (): FakeNode => node("plain", { marks: ["button"], children: [node("send")] });

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoot = path.resolve(pkgRoot, "../../vendor");
const newest = fs
  .readdirSync(vendorRoot, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^adr-crm-extension-\d/.test(e.name))
  .map((e) => e.name)
  .sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }))
  .at(-1)!;
const source = fs.readFileSync(path.join(vendorRoot, newest, "wa-dom.js"), "utf8");

type WaDom = {
  captionComposer(): FakeNode | null;
  captionSendButton(): FakeNode | null;
  sendButton(): FakeNode | null;
  emailsInText(text: unknown): string[];
  bubbleSentAtMs(bubble: unknown): number | null;
};

function load(body: FakeNode, lang = ""): WaDom {
  const win: { CRMWADom?: WaDom } = {};
  const document = {
    body,
    documentElement: { lang },
    querySelectorAll: (sel: string) => body.querySelectorAll(sel),
    querySelector: (sel: string) => descendants(body).find((n) => n.marks.includes(sel)) ?? null,
  };
  new Function("window", "document", source)(win, document);
  return win.CRMWADom!;
}

describe("data da bolha (auto-transcrição só de áudio recente)", () => {
  const bubble = (prePlain: string) => ({
    querySelector: () => ({ getAttribute: () => `${prePlain} Ana: ` }),
  });

  it("componente > 12 decide entre D/M (pt-BR) e M/D (en-US)", () => {
    const D = load(node("plain"), "pt-BR");
    expect(D.bubbleSentAtMs(bubble("[14:05, 21/7/2026]"))).toBe(new Date(2026, 6, 21, 14, 5).getTime());
    // en-US: antes virava mês 21 e a auto-transcrição nunca disparava.
    expect(D.bubbleSentAtMs(bubble("[2:05 PM, 7/21/2026]"))).toBe(new Date(2026, 6, 21, 14, 5).getTime());
  });

  it("dia e mês ambíguos seguem o idioma da página", () => {
    expect(load(node("plain"), "en-US").bubbleSentAtMs(bubble("[2:05 PM, 7/3/2026]"))).toBe(
      new Date(2026, 6, 3, 14, 5).getTime(),
    );
    expect(load(node("plain"), "pt-BR").bubbleSentAtMs(bubble("[14:05, 7/3/2026]"))).toBe(
      new Date(2026, 2, 7, 14, 5).getTime(),
    );
  });
});

const search = node("editable", { label: "Pesquisar ou começar uma nova conversa" });
const footerBox = () =>
  node("plain", { marks: ["#main footer"], children: [node("editable"), sendButton()] });

describe("e-mails nas mensagens (copiar e-mail)", () => {
  const D = load(node("plain"));

  it("acha o endereço sem levar a pontuação da frase", () => {
    expect(D.emailsInText("Me manda em joao.silva+crm@acme.com.br.")).toEqual([
      "joao.silva+crm@acme.com.br",
    ]);
    expect(D.emailsInText("contato: (ana@empresa.io), obrigado!")).toEqual(["ana@empresa.io"]);
  });

  it("não repete o mesmo endereço e limita a três", () => {
    expect(D.emailsInText("a@x.com e A@X.COM")).toEqual(["a@x.com"]);
    expect(D.emailsInText("a@x.com b@x.com c@x.com d@x.com")).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
    ]);
  });

  it("ignora texto sem e-mail, @handles e entrada vazia", () => {
    expect(D.emailsInText("segue o @perfil no instagram")).toEqual([]);
    expect(D.emailsInText("usuario@localhost")).toEqual([]);
    expect(D.emailsInText(null)).toEqual([]);
  });
});

describe("legenda do anexo (prévia de mídia)", () => {
  it("acha a legenda e a setinha DELA mesmo sem rótulo, testid ou role=dialog", () => {
    const caption = node("editable");
    const preview = node("plain", { children: [caption, sendButton()] });
    const D = load(
      node("plain", {
        children: [
          node("plain", { marks: ["#side"], children: [search] }),
          node("plain", { marks: ["#main"], children: [preview, footerBox()] }),
        ],
      }),
    );

    expect(D.captionComposer()).toBe(caption);
    // A setinha tem que ser a da prévia: a do rodapé enviaria a conversa, não o anexo.
    expect(D.captionSendButton()).toBe(preview.children[1]);
    expect(D.sendButton()).toBe(preview.children[1]);
  });

  it("sem prévia aberta, não sequestra o rodapé nem a busca", () => {
    const footer = footerBox();
    const D = load(
      node("plain", {
        children: [
          node("plain", { marks: ["#side"], children: [search] }),
          node("plain", { marks: ["#main"], children: [footer] }),
        ],
      }),
    );

    expect(D.captionComposer()).toBeNull();
    expect(D.sendButton()).toBe(footer.children[1]);
  });

  it("ignora o diálogo de encaminhar (busca + setinha, mas não é legenda)", () => {
    const forward = node("plain", {
      children: [node("editable", { label: "Pesquisar contatos" }), sendButton()],
    });
    const D = load(
      node("plain", {
        children: [node("plain", { marks: ["#main"], children: [footerBox()] }), forward],
      }),
    );

    expect(D.captionComposer()).toBeNull();
  });
});
