import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CRM_VIEW_ID } from "@adr/view-lifecycle";
import {
  MEDIA_PROBE_TIMEOUT_MS,
  createHibernationController,
  type HibernationContents,
  type HibernationDeps,
} from "./hibernation.js";

const GB = 1024 ** 3;
const NOW = 1_000_000_000;
const HOUR = 60 * 60_000;

type Tab = HibernationContents & { audible: boolean; media: boolean | "hang" };
function tab(media: boolean | "hang" = false): Tab {
  const t: Tab = {
    audible: false,
    media,
    isCurrentlyAudible: () => t.audible,
    executeJavaScript: () =>
      t.media === "hang" ? new Promise(() => undefined) : Promise.resolve({ active: t.media }),
  };
  return t;
}

function setup(overrides: Partial<HibernationDeps> = {}) {
  const services = new Map<string, Tab>([
    ["wa", tab()],
    ["yt", tab()],
  ]);
  const crm = new Map<string, Tab>();
  const lastUsedAt = new Map<string, number>([
    ["wa", NOW - 2 * HOUR],
    ["yt", NOW - 2 * HOUR],
  ]);
  let crmUsed = NOW - 2 * HOUR;
  const hibernated: string[] = [];
  const closedCrm: string[] = [];
  const state = { active: null as string | null, hidden: false, crmActive: false, downloading: false };
  const deps: HibernationDeps = {
    windowGone: () => false,
    nobodyWatching: () => state.hidden,
    appMemoryBytes: () => 0.5 * GB,
    totalMemory: () => 16 * GB,
    maxLoadedViewsSetting: () => undefined,
    downloadsInProgress: () => state.downloading,
    log: vi.fn(),
    now: () => NOW,
    serviceIds: () => [...services.keys()],
    serviceContents: (id) => services.get(id),
    serviceInfo: (id) =>
      services.has(id) ? { kind: id === "wa" ? "whatsapp" : "youtube", keepAwake: false } : undefined,
    messengerStaysAwake: () => false,
    lastUsedAt,
    activeServiceId: () => state.active,
    serviceBusy: async () => false,
    hibernateService: (id) => {
      hibernated.push(id);
      services.delete(id);
    },
    crmIds: () => [...crm.keys()],
    crmContents: (id) => crm.get(id),
    crmReady: async () => true,
    crmSurfaceActive: () => state.crmActive,
    crmActiveFor: () => state.crmActive,
    crmLastUsedAt: () => crmUsed,
    touchCrm: (at) => {
      crmUsed = at;
    },
    closeCrm: (id) => {
      closedCrm.push(id);
      crm.delete(id);
    },
    ...overrides,
  };
  const controller = createHibernationController(deps);
  return { controller, deps, services, crm, lastUsedAt, hibernated, closedCrm, state, crmUsed: () => crmUsed };
}

describe("canHibernate", () => {
  it("registra o bloqueio só uma vez por view, sem conteúdo do formulário", async () => {
    const { controller, services, deps } = setup();
    services.get("yt")!.executeJavaScript = async () => ({ active: true, reason: "form" });
    await controller.canHibernate("yt", "normal");
    await controller.canHibernate("yt", "normal");
    expect(deps.log).toHaveBeenCalledExactlyOnceWith("hibernação impedida", { view: "yt", reason: "form" });
  });

  it("aba parada há muito tempo pode hibernar", async () => {
    const { controller } = setup();
    await expect(controller.canHibernate("yt", "normal")).resolves.toBe(true);
  });

  it("não hiberna: tocando áudio, em download, na frente com a janela à vista, ocupada ou sem resposta", async () => {
    const audible = setup();
    audible.services.get("yt")!.audible = true;
    await expect(audible.controller.canHibernate("yt", "normal")).resolves.toBe(false);

    const downloading = setup();
    downloading.state.downloading = true;
    await expect(downloading.controller.canHibernate("yt", "normal")).resolves.toBe(false);

    const front = setup();
    front.state.active = "yt";
    await expect(front.controller.canHibernate("yt", "normal")).resolves.toBe(false);
    front.state.hidden = true; // minimizou: aí até a aba da frente pode
    await expect(front.controller.canHibernate("yt", "normal")).resolves.toBe(true);

    const meeting = setup({ serviceBusy: async (id) => id === "yt" });
    await expect(meeting.controller.canHibernate("yt", "normal")).resolves.toBe(false);

    const playing = setup();
    playing.services.get("yt")!.media = true;
    await expect(playing.controller.canHibernate("yt", "normal")).resolves.toBe(false);

    const messenger = setup({ messengerStaysAwake: (id) => id === "wa" });
    await expect(messenger.controller.canHibernate("wa", "normal")).resolves.toBe(false);
  });

  it("sonda de mídia travada: não hiberna, e não empilha outra sonda enquanto pendente", async () => {
    vi.useFakeTimers();
    try {
      const { controller, services } = setup();
      const yt = services.get("yt")!;
      yt.media = "hang";
      const spy = vi.spyOn(yt, "executeJavaScript");
      const first = controller.canHibernate("yt", "normal");
      await vi.advanceTimersByTimeAsync(MEDIA_PROBE_TIMEOUT_MS);
      await expect(first).resolves.toBe(false);
      await expect(controller.canHibernate("yt", "normal")).resolves.toBe(false);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("prazo por serviço", () => {
  it("respeita o prazo escolhido, mas a pressão e o teto continuam valendo", async () => {
    let bytes = 0.5 * GB;
    const { controller, hibernated, lastUsedAt, services } = setup({
      appMemoryBytes: () => bytes,
      serviceInfo: () => ({ kind: "notion", keepAwake: false, hibernateAfterMinutes: 30 }),
    });
    lastUsedAt.set("wa", NOW - 15 * 60_000);
    services.delete("yt");
    await controller.enforce();
    expect(hibernated).toEqual([]);
    bytes = 10 * GB;
    await controller.enforce();
    expect(hibernated).toEqual(["wa"]);
  });
});

describe("passada de hibernação", () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.useRealTimers());

  it("hiberna as ociosas, carimba a aba da frente e nunca a derruba com a janela à vista", async () => {
    const { controller, hibernated, lastUsedAt, state } = setup();
    state.active = "wa";
    await controller.enforce();
    expect(hibernated).toEqual(["yt"]);
    expect(lastUsedAt.get("wa")).toBe(NOW);
  });

  it("janela escondida: a aba da frente envelhece e também hiberna", async () => {
    const { controller, hibernated, lastUsedAt, state } = setup();
    state.active = "wa";
    state.hidden = true;
    await controller.enforce();
    expect(hibernated.sort()).toEqual(["wa", "yt"]);
    expect(lastUsedAt.get("wa")).toBe(NOW - 2 * HOUR);
  });

  it("acima do teto, fecha as abas mais antigas, mas a recém-deixada (< 90 s) fica", async () => {
    const { controller, hibernated, lastUsedAt, services } = setup({ maxLoadedViewsSetting: () => 1 });
    services.set("gm", tab());
    lastUsedAt.set("wa", NOW - 3 * 60_000);
    lastUsedAt.set("yt", NOW - 4 * 60_000);
    lastUsedAt.set("gm", NOW - 60_000);
    await controller.enforce();
    // Antes a graça era a ociosidade inteira (10 min) e o teto nunca agia.
    expect([...hibernated].sort()).toEqual(["wa", "yt"]);
  });

  it("CRM ocioso fecha só se estiver logado e parado", async () => {
    const ok = setup();
    ok.crm.set("ws1", tab());
    await ok.controller.enforce();
    expect(ok.closedCrm).toEqual(["ws1"]);

    const loggedOut = setup({ crmReady: async () => false });
    loggedOut.crm.set("ws1", tab());
    await loggedOut.controller.enforce();
    expect(loggedOut.closedCrm).toEqual([]);

    const playing = setup();
    playing.crm.set("ws1", tab(true));
    await playing.controller.enforce();
    expect(playing.closedCrm).toEqual([]);
  });

  it("CRM na frente com a janela à vista é carimbado e fica", async () => {
    const { controller, crm, closedCrm, state, crmUsed } = setup();
    crm.set("ws1", tab());
    state.crmActive = true;
    await controller.enforce();
    expect(closedCrm).toEqual([]);
    expect(crmUsed()).toBe(NOW);
  });

  it("uma passada por vez e nada com a janela fechada", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const busy = vi.fn(async () => {
      await gate;
      return false;
    });
    const { controller } = setup({ serviceBusy: busy });
    const first = controller.enforce();
    await controller.enforce();
    release();
    await first;
    expect(busy).toHaveBeenCalledTimes(2); // wa e yt, só da primeira passada

    const closed = setup({ windowGone: () => true });
    await closed.controller.enforce();
    expect(closed.hibernated).toEqual([]);
  });

  it("pressão de RAM vai ao log só quando muda", () => {
    let bytes = 0.5 * GB;
    const { controller, deps } = setup({ appMemoryBytes: () => bytes });
    expect(controller.currentMemoryPressure()).toBe("normal");
    bytes = 15 * GB;
    const high = controller.currentMemoryPressure();
    expect(high).not.toBe("normal");
    controller.currentMemoryPressure();
    expect(deps.log).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith("memória", expect.objectContaining({ pressure: high }));
  });

  it("CRM entra no LRU como uma aba só", async () => {
    const { controller, crm, closedCrm } = setup({ maxLoadedViewsSetting: () => 1 });
    crm.set("ws1", tab());
    crm.set("ws2", tab());
    await controller.enforce();
    expect(closedCrm.sort()).toEqual(["ws1", "ws2"]);
    expect(CRM_VIEW_ID).toBeTruthy();
  });
});
