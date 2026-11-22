import { describe, expect, it } from "vitest";
import {
  CRM_VIEW_ID,
  HIBERNATE_AFTER_MS,
  hibernateAfterMs,
  HIBERNATE_MINIMIZED_MS,
  keepAwakeBlocksHibernation,
  maxLoadedViewsUnderPressure,
  memoryBudgetBytes,
  memoryPressure,
  pickViewsToHibernate,
  shouldHibernateForIdle,
  recommendedMaxLoadedViews,
} from "./hibernate.js";

describe("CRM_VIEW_ID", () => {
  it("é o sentinela único do CRM no LRU", () => {
    expect(CRM_VIEW_ID).toBe("crm");
  });
});

describe("keepAwakeBlocksHibernation", () => {
  it("pin normal sempre protege", () => {
    expect(
      keepAwakeBlocksHibernation({
        keepAwake: true,
        pressure: "normal",
        audible: false,
        mediaService: true,
      }),
    ).toBe(true);
  });

  it("mídia muda cede em high/critical; com áudio não", () => {
    expect(
      keepAwakeBlocksHibernation({
        keepAwake: true,
        pressure: "critical",
        audible: false,
        mediaService: true,
      }),
    ).toBe(false);
    expect(
      keepAwakeBlocksHibernation({
        keepAwake: true,
        pressure: "high",
        audible: true,
        mediaService: true,
      }),
    ).toBe(true);
  });

  it("pin de WhatsApp continua em critical", () => {
    expect(
      keepAwakeBlocksHibernation({
        keepAwake: true,
        pressure: "critical",
        audible: false,
        mediaService: false,
      }),
    ).toBe(true);
  });
});

const GB = 1024 ** 3;

describe("recommendedMaxLoadedViews", () => {
  it("scales by RAM tiers", () => {
    expect(recommendedMaxLoadedViews(8 * 1024 ** 3)).toBe(3);
    expect(recommendedMaxLoadedViews(16 * 1024 ** 3)).toBe(4);
    expect(recommendedMaxLoadedViews(32 * 1024 ** 3)).toBe(6);
    expect(recommendedMaxLoadedViews(64 * 1024 ** 3)).toBe(8);
    // O que os.totalmem() reporta de verdade em 12/24/48 GB nominais.
    expect(recommendedMaxLoadedViews(11.8 * 1024 ** 3)).toBe(4);
    expect(recommendedMaxLoadedViews(23.7 * 1024 ** 3)).toBe(6);
    expect(recommendedMaxLoadedViews(47.6 * 1024 ** 3)).toBe(8);
  });
});

describe("pickViewsToHibernate", () => {
  it("never hibernates active or keepAwake", () => {
    const out = pickViewsToHibernate(
      [
        { id: "a", lastUsedAt: 1, keepAwake: false, active: true },
        { id: "b", lastUsedAt: 2, keepAwake: true, active: false },
        { id: "c", lastUsedAt: 0, keepAwake: false, active: false },
        { id: "d", lastUsedAt: 3, keepAwake: false, active: false },
      ],
      2,
    );
    expect(out).toEqual(["c", "d"]);
    expect(out).not.toContain("a");
    expect(out).not.toContain("b");
  });

  it("counts CRM toward the loaded-view cap", () => {
    expect(
      pickViewsToHibernate(
        [
          { id: "wa-1", lastUsedAt: 3, keepAwake: false, active: true },
          { id: "wa-2", lastUsedAt: 2, keepAwake: false, active: false },
          { id: CRM_VIEW_ID, lastUsedAt: 1, keepAwake: false, active: false },
        ],
        2,
      ),
    ).toEqual([CRM_VIEW_ID]);
  });

  it("returns empty when under limit", () => {
    expect(
      pickViewsToHibernate([{ id: "a", lastUsedAt: 1, keepAwake: false, active: true }], 4),
    ).toEqual([]);
  });

  it("does not hibernate a view immediately after leaving it under memory pressure", () => {
    const now = 10 * 60 * 1000;
    expect(
      pickViewsToHibernate(
        [
          { id: "wa-1", lastUsedAt: now - 20_000, keepAwake: true, active: false },
          { id: "wa-2", lastUsedAt: now - 20_000, keepAwake: true, active: false },
          { id: "wa-3", lastUsedAt: now - 1_000, keepAwake: false, active: false },
          { id: "crm-helper", lastUsedAt: now, keepAwake: false, active: true },
        ],
        3,
        { now, minimumIdleMs: 3 * 60 * 1000 },
      ),
    ).toEqual([]);
  });

  it("allows the LRU victim after the memory-pressure idle grace", () => {
    const now = 10 * 60 * 1000;
    expect(
      pickViewsToHibernate(
        [
          { id: "wa-1", lastUsedAt: now - 20_000, keepAwake: true, active: false },
          { id: "wa-2", lastUsedAt: now - 20_000, keepAwake: true, active: false },
          { id: "wa-3", lastUsedAt: now - 4 * 60 * 1000, keepAwake: false, active: false },
          { id: "crm-helper", lastUsedAt: now, keepAwake: false, active: true },
        ],
        3,
        { now, minimumIdleMs: 3 * 60 * 1000 },
      ),
    ).toEqual(["wa-3"]);
  });
});

describe("HIBERNATE_AFTER_MS", () => {
  it("is 10 minutes", () => {
    expect(HIBERNATE_AFTER_MS).toBe(10 * 60 * 1000);
  });
});

describe("memoryBudgetBytes", () => {
  it("é fatia da máquina, presa entre 1,5 GB e 4 GB", () => {
    expect(memoryBudgetBytes(4 * GB)).toBe(1.5 * GB);
    expect(memoryBudgetBytes(8 * GB)).toBeCloseTo(2.8 * GB, -6);
    expect(memoryBudgetBytes(16 * GB)).toBe(4 * GB);
  });

  it("máquina grande (24 GB+) ganha teto de 6 GB, ainda longe da fatia", () => {
    // Sem teto, 35% de 32 GB seriam 11 GB — teto nenhum, que é como o app
    // chegava a "comendo RAM" sem nunca disparar o LRU.
    expect(memoryBudgetBytes(31.6 * GB)).toBe(6 * GB);
    expect(memoryBudgetBytes(64 * GB)).toBe(6 * GB);
    // Uma máquina de 24 GB mede ~23,7 GiB no os.totalmem(): tem de ganhar os 6 GB.
    expect(memoryBudgetBytes(23.7 * GB)).toBe(6 * GB);
    // 20 GB (~19,8 GiB) fica no teto antigo.
    expect(memoryBudgetBytes(19.8 * GB)).toBe(4 * GB);
  });
});

describe("memoryPressure", () => {
  it("classifica pelo que o app pesa agora", () => {
    expect(memoryPressure(2 * GB, 32 * GB)).toBe("normal");
    // O caso do diagnóstico de 01/10: 4,2 GB em 31,6 GB já não é pressão.
    expect(memoryPressure(4.2 * GB, 31.6 * GB)).toBe("normal");
    expect(memoryPressure(6.2 * GB, 32 * GB)).toBe("high");
    expect(memoryPressure(8.5 * GB, 32 * GB)).toBe("critical");
    expect(memoryPressure(4.2 * GB, 16 * GB)).toBe("high");
  });

  it("sem medida confiável não aperta nada", () => {
    expect(memoryPressure(0, 32 * GB)).toBe("normal");
    expect(memoryPressure(4 * GB, 0)).toBe("normal");
  });
});

describe("maxLoadedViewsUnderPressure", () => {
  it("aperta o teto conforme a pressão, sem nunca zerar", () => {
    expect(maxLoadedViewsUnderPressure(6, "normal")).toBe(6);
    expect(maxLoadedViewsUnderPressure(6, "high")).toBe(3);
    expect(maxLoadedViewsUnderPressure(3, "high")).toBe(1);
    expect(maxLoadedViewsUnderPressure(6, "critical")).toBe(1);
  });
});

describe("hibernateAfterMs", () => {
  it("encurta a ociosidade sob pressão", () => {
    expect(hibernateAfterMs("normal")).toBe(HIBERNATE_AFTER_MS);
    expect(hibernateAfterMs("high")).toBe(3 * 60 * 1000);
    expect(hibernateAfterMs("critical")).toBe(60 * 1000);
  });

  it("minimizado encurta, mas nunca afrouxa o que a pressão já apertou", () => {
    expect(hibernateAfterMs("normal", true)).toBe(HIBERNATE_MINIMIZED_MS);
    expect(hibernateAfterMs("critical", true)).toBe(60 * 1000);
  });
});

describe("shouldHibernateForIdle", () => {
  const base = { lastUsedAt: 1_000, now: 1_000 + 11 * 60 * 1000, idleMs: HIBERNATE_AFTER_MS };

  it("a aba da frente é intocável enquanto alguém está olhando", () => {
    expect(shouldHibernateForIdle({ ...base, isActive: true, hidden: false })).toBe(false);
  });

  it("com a janela escondida, a aba da frente envelhece como as outras", () => {
    expect(shouldHibernateForIdle({ ...base, isActive: true, hidden: true })).toBe(true);
  });

  it("escondida não basta: a ociosidade ainda tem que ter passado", () => {
    const recente = { ...base, now: base.lastUsedAt + 30 * 1000 };
    expect(shouldHibernateForIdle({ ...recente, isActive: true, hidden: true })).toBe(false);
  });

  it("view que nunca foi aberta não hiberna por ociosidade — é caso do LRU", () => {
    expect(shouldHibernateForIdle({ ...base, lastUsedAt: 0, isActive: false, hidden: true })).toBe(
      false,
    );
  });
});
