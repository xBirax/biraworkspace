import { describe, expect, it } from "vitest";
import { unreadFromOutlookFolderTitle } from "./outlook-badge.js";

describe("unreadFromOutlookFolderTitle", () => {
  it("lê as não lidas da caixa de entrada (título real do Outlook web)", () => {
    expect(unreadFromOutlookFolderTitle("Caixa de Entrada - 11.555 itens (6.771 não lidos)")).toBe(6771);
    expect(unreadFromOutlookFolderTitle("Inbox - 11,555 items (6,771 unread)")).toBe(6771);
    expect(unreadFromOutlookFolderTitle("Caixa de Entrada - 3 itens (1 não lido)")).toBe(1);
    expect(unreadFromOutlookFolderTitle("Inbox - 9 items (1 234 567 unread)")).toBe(99999);
  });

  it("caixa de entrada sem não lidas é zero", () => {
    expect(unreadFromOutlookFolderTitle("Caixa de Entrada - 12 itens (0 não lidos)")).toBe(0);
    expect(unreadFromOutlookFolderTitle("Inbox - 12 items")).toBe(0);
  });

  it("outra pasta ou formato desconhecido não sabe o contador", () => {
    expect(unreadFromOutlookFolderTitle("Itens Excluídos - 46 itens (17 não lidos)")).toBeNull();
    expect(unreadFromOutlookFolderTitle("Lixo Eletrônico - 40 itens (36 não lidos)")).toBeNull();
    expect(unreadFromOutlookFolderTitle("Caixa de Entrada")).toBeNull();
    expect(unreadFromOutlookFolderTitle("")).toBeNull();
  });
});
