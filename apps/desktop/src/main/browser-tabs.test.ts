import { describe, expect, it } from "vitest";
import {
  collapseBrowserServices,
  collapseRailBrowserTabs,
  expandRailBrowserTabs,
  cycleTab,
  mergeTabOrderIntoRail,
  moveTabAfter,
  purgeClosedBrowserTabs,
  tabAfterClose,
  tabsToTheRight,
  tabTitle,
} from "./browser-tabs.js";

describe("tabTitle", () => {
  it("usa o título da página", () => {
    expect(tabTitle("Google", "https://www.google.com/", "ADR Browser")).toBe("Google");
  });

  it("cai no domínio quando o título é a própria URL ou vazio", () => {
    const url = "https://www.example.com/a?b=1";
    expect(tabTitle(url, url, "ADR Browser")).toBe("example.com");
    expect(tabTitle("  ", url, "ADR Browser")).toBe("example.com");
  });

  it("cai no nome do serviço sem página web", () => {
    expect(tabTitle("", "", "ADR Browser 2")).toBe("ADR Browser 2");
    expect(tabTitle("", "data:text/html,oi", "ADR Browser")).toBe("ADR Browser");
  });

  it("corta título enorme", () => {
    expect(tabTitle("x".repeat(500), "https://a.com/", "B")).toHaveLength(200);
  });
});

describe("cycleTab", () => {
  const ids = ["a", "b", "c"];

  it("anda para frente e para trás dando a volta", () => {
    expect(cycleTab(ids, "a", 1)).toBe("b");
    expect(cycleTab(ids, "c", 1)).toBe("a");
    expect(cycleTab(ids, "a", -1)).toBe("c");
    expect(cycleTab(ids, "b", -1)).toBe("a");
  });

  it("aba única fica nela mesma; lista vazia não tem destino", () => {
    expect(cycleTab(["a"], "a", 1)).toBe("a");
    expect(cycleTab([], "a", 1)).toBeUndefined();
  });

  it("de fora da faixa vai para a primeira (ou a última, para trás)", () => {
    expect(cycleTab(ids, "zap", 1)).toBe("a");
    expect(cycleTab(ids, "zap", -1)).toBe("c");
  });
});

describe("tabAfterClose", () => {
  it("ativa a da direita, como no Chrome", () => {
    expect(tabAfterClose(["a", "b", "c"], "b")).toBe("c");
  });

  it("a última fechada passa para a da esquerda", () => {
    expect(tabAfterClose(["a", "b", "c"], "c")).toBe("b");
  });

  it("a única aba não deixa vizinha; aba desconhecida também não", () => {
    expect(tabAfterClose(["a"], "a")).toBeUndefined();
    expect(tabAfterClose(["a", "b"], "x")).toBeUndefined();
  });
});

describe("mergeTabOrderIntoRail", () => {
  // Lateral: WhatsApp, aba 1, CRM, Gmail, aba 2, aba 3.
  const rail = ["wa", "t1", "crm", "gmail", "t2", "t3"];
  const tabs = ["t1", "t2", "t3"];

  it("troca só as abas de lugar; o resto da lateral fica onde estava", () => {
    expect(mergeTabOrderIntoRail(rail, tabs, ["t3", "t1", "t2"])).toEqual([
      "wa",
      "t3",
      "crm",
      "gmail",
      "t1",
      "t2",
    ]);
  });

  it("mesma ordem devolve a lateral igual", () => {
    expect(mergeTabOrderIntoRail(rail, tabs, tabs)).toEqual(rail);
  });

  it("recusa ordem desatualizada, repetida ou com id de fora", () => {
    expect(mergeTabOrderIntoRail(rail, tabs, ["t1", "t2"])).toBeNull();
    expect(mergeTabOrderIntoRail(rail, tabs, ["t1", "t1", "t2"])).toBeNull();
    expect(mergeTabOrderIntoRail(rail, tabs, ["t1", "t2", "gmail"])).toBeNull();
    expect(mergeTabOrderIntoRail(rail, tabs, ["t1", "t2", "t3", "t4"])).toBeNull();
  });

  it("aba que não está na lateral não entra", () => {
    expect(mergeTabOrderIntoRail(["wa", "t1"], ["t1", "t9"], ["t9"])).toBeNull();
    expect(mergeTabOrderIntoRail(["wa", "t1"], ["t1", "t9"], ["t1"])).toEqual(["wa", "t1"]);
  });
});

describe("moveTabAfter", () => {
  it("põe a aba logo depois da outra", () => {
    expect(moveTabAfter(["a", "b", "c", "new"], "new", "a")).toEqual(["a", "new", "b", "c"]);
    expect(moveTabAfter(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
  });

  it("deixa como está quando falta alguma das duas", () => {
    expect(moveTabAfter(["a", "b"], "x", "a")).toEqual(["a", "b"]);
    expect(moveTabAfter(["a", "b"], "a", "x")).toEqual(["a", "b"]);
    expect(moveTabAfter(["a", "b"], "a", "a")).toEqual(["a", "b"]);
  });
});

describe("tabsToTheRight", () => {
  it("devolve as que vêm depois", () => {
    expect(tabsToTheRight(["a", "b", "c"], "a")).toEqual(["b", "c"]);
    expect(tabsToTheRight(["a", "b", "c"], "c")).toEqual([]);
    expect(tabsToTheRight(["a", "b", "c"], "x")).toEqual([]);
  });
});

describe("purgeClosedBrowserTabs", () => {
  const base = (services: Array<Record<string, unknown>>, deletedWorkspace = false) =>
    ({
      workspaces: [{ id: "w1", deletedAt: deletedWorkspace ? "2026-10-01T00:00:00Z" : undefined }],
      services,
    }) as unknown as Parameters<typeof purgeClosedBrowserTabs>[0];

  it("apaga só aba do Browser fechada", () => {
    const state = base([
      { id: "t1", kind: "browser", workspaceId: "w1", deletedAt: "2026-10-01T00:00:00Z" },
      { id: "t2", kind: "browser", workspaceId: "w1" },
      { id: "wa", kind: "whatsapp", workspaceId: "w1", deletedAt: "2026-10-01T00:00:00Z" },
    ]);
    expect(purgeClosedBrowserTabs(state).services.map((s) => s.id)).toEqual(["t2", "wa"]);
  });

  it("mantém as abas de workspace excluído (restaurar o traz de volta)", () => {
    const state = base(
      [{ id: "t1", kind: "browser", workspaceId: "w1", deletedAt: "2026-10-01T00:00:00Z" }],
      true,
    );
    expect(purgeClosedBrowserTabs(state)).toBe(state);
  });

  it("devolve o mesmo objeto quando não há o que apagar", () => {
    const state = base([{ id: "t2", kind: "browser", workspaceId: "w1" }]);
    expect(purgeClosedBrowserTabs(state)).toBe(state);
  });
});

describe("ADR Browser agrupado na barra lateral", () => {
  const rail = ["wa", "t1", "crm", "t2", "yt", "t3"];
  const tabs = ["t1", "t2", "t3"];

  it("mostra um ícone só, na posição da primeira aba", () => {
    expect(collapseRailBrowserTabs(rail, tabs, "t3")).toEqual(["wa", "t3", "crm", "yt"]);
  });

  it("sem aba representante, deixa a lateral como está", () => {
    expect(collapseRailBrowserTabs(rail, tabs, undefined)).toEqual(rail);
    expect(collapseRailBrowserTabs(rail, tabs, "wa")).toEqual(rail);
  });

  it("agrupa também a lista de serviços", () => {
    const services = ["wa", "t1", "t2", "yt", "t3"].map((id) => ({ id }));
    expect(collapseBrowserServices(services, tabs, "t2").map((s) => s.id)).toEqual([
      "wa",
      "t2",
      "yt",
    ]);
  });

  it("arrastar o ícone leva todas as abas juntas, na ordem da faixa", () => {
    expect(expandRailBrowserTabs(["t3", "wa", "crm", "yt"], ["t1", "t2", "t3"], "t3")).toEqual([
      "t1",
      "t2",
      "t3",
      "wa",
      "crm",
      "yt",
    ]);
  });

  it("ordem sem o ícone põe as abas no fim", () => {
    expect(expandRailBrowserTabs(["wa", "crm"], ["t1", "t2"], "t1")).toEqual([
      "wa",
      "crm",
      "t1",
      "t2",
    ]);
  });
});
