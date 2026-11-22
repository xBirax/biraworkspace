import { describe, expect, it, vi } from "vitest";
import {
  buildNotificationGuard,
  notificationSettingsPatchScript,
  openWhatsAppNotificationChatScript,
  isUnreadReloadBlip,
  nextClearedUnread,
  shouldAllowServiceNotification,
  UNREAD_BLIP_MS,
} from "./notifications.js";

describe("nextClearedUnread", () => {
  const now = 1_000_000;
  const visible = (raw: number, base: number | undefined) => raw - Math.min(base ?? 0, raw);

  it("só conta o que chega depois de limpar", () => {
    expect(visible(77, nextClearedUnread(76, 76, 77, undefined, now))).toBe(1);
  });

  it("ler parte do que havia baixa a base", () => {
    const base = nextClearedUnread(76, 76, 70, undefined, now);
    expect(base).toBe(70);
    expect(visible(71, nextClearedUnread(base, 70, 71, undefined, now))).toBe(1);
  });

  it("recarga (zera e volta igual) não reexibe o contador limpo", () => {
    const drop = { count: 76, at: now - 5_000 };
    expect(nextClearedUnread(76, 76, 0, drop, now)).toBe(76);
    expect(visible(76, nextClearedUnread(76, 0, 76, drop, now))).toBe(0);
    expect(visible(78, nextClearedUnread(76, 0, 78, drop, now))).toBe(2);
  });

  it("leu tudo e chegou mensagem nova: aparece", () => {
    expect(nextClearedUnread(76, 0, 1, { count: 76, at: now - 5_000 }, now)).toBeUndefined();
    expect(
      nextClearedUnread(76, 0, 80, { count: 76, at: now - UNREAD_BLIP_MS }, now),
    ).toBeUndefined();
  });

  it("app recém-aberto não perde o que foi limpo", () => {
    expect(visible(76, nextClearedUnread(76, 0, 76, undefined, now))).toBe(0);
  });
});

describe("isUnreadReloadBlip", () => {
  it("não re-anuncia o mesmo contador depois de a aba recarregar", () => {
    const drop = { count: 5, at: 1000 };
    expect(isUnreadReloadBlip(drop, 5, 1000 + 30_000)).toBe(true);
    expect(isUnreadReloadBlip(drop, 3, 1000 + 30_000)).toBe(true);
    // Mais do que antes é mensagem nova; muito depois é um 0 de verdade.
    expect(isUnreadReloadBlip(drop, 6, 1000 + 30_000)).toBe(false);
    expect(isUnreadReloadBlip(drop, 5, 1000 + UNREAD_BLIP_MS)).toBe(false);
    expect(isUnreadReloadBlip(undefined, 5, 1000)).toBe(false);
  });
});

const base = {
  enabled: true,
  respectWhatsAppMute: true,
  serviceEnabled: {},
  trayBadge: true,
  quietHours: false,
  quietFromHour: 19,
  quietToHour: 8,
};

describe("notification policy", () => {
  it("bloqueia CRM mesmo com preferência antiga habilitada", () => {
    expect(shouldAllowServiceNotification(base, "crm")).toBe(false);
    expect(shouldAllowServiceNotification({ ...base, serviceEnabled: { crm: true } }, "crm")).toBe(
      false,
    );
  });
  it("honors master and per-service toggles", () => {
    expect(shouldAllowServiceNotification({ ...base, enabled: false }, "wa-1")).toBe(false);
    expect(
      shouldAllowServiceNotification({ ...base, serviceEnabled: { "wa-1": false } }, "wa-1"),
    ).toBe(false);
    expect(shouldAllowServiceNotification(base, "wa-1")).toBe(true);
  });

  it("honours a custom quiet window, including one that does not cross midnight", () => {
    const diurno = { ...base, quietHours: true, quietFromHour: 13, quietToHour: 15 };
    expect(shouldAllowServiceNotification(diurno, "wa-1", 14)).toBe(false);
    expect(shouldAllowServiceNotification(diurno, "wa-1", 15)).toBe(true);
    expect(shouldAllowServiceNotification(diurno, "wa-1", 3)).toBe(true);
    // from === to é janela vazia, não silêncio de 24h.
    const vazia = { ...base, quietHours: true, quietFromHour: 9, quietToHour: 9 };
    expect(shouldAllowServiceNotification(vazia, "wa-1", 9)).toBe(true);
  });

  it("silences outside business hours only when quietHours is on", () => {
    const quiet = { ...base, quietHours: true };
    expect(shouldAllowServiceNotification(quiet, "wa-1", 21)).toBe(false);
    expect(shouldAllowServiceNotification(quiet, "wa-1", 7)).toBe(false);
    expect(shouldAllowServiceNotification(quiet, "wa-1", 8)).toBe(true);
    expect(shouldAllowServiceNotification(quiet, "wa-1", 18)).toBe(true);
    expect(shouldAllowServiceNotification(base, "wa-1", 21)).toBe(true);
  });

  // Sem jsdom no projeto: o DOM mínimo que o script realmente usa (lista de
  // conversas + click) cabe em um stub, e roda o script de verdade.
  const runGuard = (
    chats: Array<{ name: string; muted?: boolean }>,
    settings: Record<string, unknown> = {},
  ) => {
    const clicked: string[] = [];
    const built: string[] = [];
    const logs: string[] = [];
    const rows = chats.map((chat) => ({
      click: () => clicked.push(chat.name),
      querySelector: (selector: string) => {
        if (selector === "span[title]") {
          return { getAttribute: () => chat.name, click: () => clicked.push(chat.name) };
        }
        return selector.includes("muted") && chat.muted ? {} : null;
      },
    }));
    const closed: string[] = [];
    const listeners: Array<{ name: string; fn: () => void }> = [];
    function Orig(this: unknown, title: string) {
      built.push(title);
      return {
        addEventListener: (name: string, fn: () => void) => listeners.push({ name, fn }),
        close: () => closed.push(title),
      };
    }
    Orig.permission = "granted";
    Orig.requestPermission = () => Promise.resolve("granted");
    const win: Record<string, unknown> = { Notification: Orig };
    const doc = { querySelectorAll: () => rows };
    const script = buildNotificationGuard(
      JSON.stringify({ enabled: true, respectWhatsAppMute: true, ...settings }),
      "wa-1",
    );
    new Function("window", "document", "console", "location", `return ${script}`)(
      win,
      doc,
      {
        log: (line: string) => logs.push(line),
      },
      { hostname: "web.whatsapp.com" },
    );
    const Notify = win["Notification"] as new (title: string) => unknown;
    return {
      notify: (title: string) => new Notify(title),
      clicked,
      built,
      logs,
      closed,
      click: () => listeners.filter((l) => l.name === "click").forEach((l) => l.fn()),
      closeAll: () => (win["__adrCloseNotifs"] as () => boolean)(),
      /** O que o main manda quando as configurações mudam (fim da reunião etc.). */
      patch: (next: Record<string, unknown>) =>
        new Function("window", `return ${notificationSettingsPatchScript(JSON.stringify(next))}`)(win),
    };
  };

  it("encaminha conversa e conta ao main para abrir após foco/PIN", () => {
    const guard = runGuard([{ name: "Fulano de Tal" }, { name: "Ana Silva" }]);
    guard.notify("Ana Silva | 2 mensagens");
    expect(guard.built).toEqual(["Ana Silva | 2 mensagens"]);
    guard.click();
    expect(guard.clicked).toEqual([]);
    expect(guard.logs).toEqual([
      'ADR_OPEN_WHATSAPP_CHAT:{"serviceId":"wa-1","title":"Ana Silva | 2 mensagens"}',
    ]);
  });

  it("avalia o não perturbe na hora da notificação, não na injeção", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 9, 2, 7, 30));
      const guard = runGuard([], { quietHours: true, quietFromHour: 19, quietToHour: 8 });
      guard.notify("antes das 8");
      // Mesmo script, já injetado: passou das 8h, volta a notificar.
      vi.setSystemTime(new Date(2026, 9, 2, 8, 10));
      guard.notify("depois das 8");
      expect(guard.built).toEqual(["depois das 8"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fica calado durante a reunião do Meet e volta quando ela acaba", () => {
    const guard = runGuard([], { meetingQuiet: true });
    guard.notify("durante a reunião");
    expect(guard.built).toEqual([]);
    guard.patch({ enabled: true, respectWhatsAppMute: true, meetingQuiet: false });
    guard.notify("depois da reunião");
    expect(guard.built).toEqual(["depois da reunião"]);
  });

  it("com PIN, o toast mostra quem mandou mas não o texto", () => {
    const seen: Array<{ title: string; body: string | undefined }> = [];
    const win: Record<string, unknown> = {
      Notification: Object.assign(
        function (this: unknown, title: string, options?: { body?: string }) {
          seen.push({ title, body: options?.body });
          return { addEventListener: () => undefined, close: () => undefined };
        },
        { permission: "granted", requestPermission: () => Promise.resolve("granted") },
      ),
    };
    const script = buildNotificationGuard(JSON.stringify({ enabled: true, hidePreview: true }), "wa-1");
    new Function("window", "document", "console", "location", `return ${script}`)(
      win,
      { querySelectorAll: () => [] },
      { log: () => undefined },
      { hostname: "web.whatsapp.com" },
    );
    const Notify = win["Notification"] as new (title: string, options?: { body?: string }) => unknown;
    new Notify("Ana Silva", { body: "segredo do contrato" });
    expect(seen).toEqual([{ title: "Ana Silva", body: "Nova mensagem" }]);
  });

  it("não notifica conversa silenciada", () => {
    const guard = runGuard([{ name: "Grupo Barulhento", muted: true }]);
    guard.notify("Grupo Barulhento");
    expect(guard.built).toEqual([]);
    guard.click();
    expect(guard.clicked).toEqual([]);
  });

  // "Limpar" precisa fechar os toasts que já foram para o SO — é o que tira a
  // marca do ícone na barra do Windows.
  it("fecha as notificações vivas e esvazia a lista", () => {
    const guard = runGuard([{ name: "Ana Silva" }, { name: "Fulano de Tal" }]);
    guard.notify("Ana Silva");
    guard.notify("Fulano de Tal");
    expect(guard.closeAll()).toBe(true);
    expect(guard.closed).toEqual(["Ana Silva", "Fulano de Tal"]);
    guard.closeAll();
    expect(guard.closed).toHaveLength(2);
  });

  it("injects mute-aware Notification guard", () => {
    const script = buildNotificationGuard(
      JSON.stringify({ enabled: true, respectWhatsAppMute: true }),
      "wa-1",
    );
    expect(script).toContain("muteExpiration");
    expect(script).toContain("Notification");
    expect(script).toContain("ADR_FOCUS_SERVICE");
    expect(script).toContain("wa-1");
  });
});

describe("abrir conversa da notificação", () => {
  const runOpen = (
    title: string,
    names: () => string[],
    header = "",
    opts: { headerSpans?: boolean; noHeader?: boolean } = {},
  ) => {
    const clicked: string[] = [];
    let opened = header;
    // headerSpans=false: WhatsApp sem span[title] no cabeçalho (só o texto).
    const headerSpans = opts.headerSpans ?? true;
    const node = (name: string) => ({
      getAttribute: () => name,
      click: () => {
        clicked.push(name);
        opened = name;
      },
    });
    const doc = {
      querySelectorAll: (selector: string) => {
        if (selector.startsWith("#main")) return opened && headerSpans ? [node(opened)] : [];
        if (selector.startsWith("#side")) return [];
        // A fixture só fornece linhas com role=row: o seletor antigo falharia.
        if (!selector.includes('[role="row"]')) return [];
        return names().map((name) => ({ querySelectorAll: () => [node(name)] }));
      },
      querySelector: (selector: string) =>
        selector === "#main header" && opened && !opts.noHeader ? { textContent: `${opened}visto por último hoje` } : null,
    };
    const result = new Function(
      "window",
      "document",
      "location",
      `return ${openWhatsAppNotificationChatScript(title)}`,
    )({}, doc, { hostname: "web.whatsapp.com" }) as Promise<boolean>;
    return { result, clicked };
  };

  it("abre role=row, com título exato mesmo havendo nome parecido antes", async () => {
    const test = runOpen("Ana | 2 mensagens", () => ["Ana Silva", "Ana"]);
    expect(await test.result).toBe(true);
    expect(test.clicked).toEqual(["Ana"]);
  });

  it("contato com \"|\" no próprio nome: abre pelo nome inteiro, não pelo pedaço", async () => {
    const test = runOpen("Juliana Amaral | WayStar", () => ["Juliana Amaral", "Juliana Amaral | WayStar"]);
    expect(await test.result).toBe(true);
    expect(test.clicked).toEqual(["Juliana Amaral | WayStar"]);
  });

  it("cabeçalho sem span[title] (WhatsApp mudou): confirma pelo texto do cabeçalho", async () => {
    const test = runOpen("Letícia Maria | ADR Agência", () => [], "Letícia Maria | ADR Agência", {
      headerSpans: false,
    });
    expect(await test.result).toBe(true);
    expect(test.clicked).toEqual([]);
  });

  it("clicou na linha certa e nada confirmou: não acusa erro falso", async () => {
    vi.useFakeTimers();
    try {
      const test = runOpen("Cleia Silva", () => ["Cleia Silva"], "", { headerSpans: false, noHeader: true });
      await vi.runAllTimersAsync();
      expect(test.clicked).toEqual(["Cleia Silva"]);
      expect(await test.result).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("não clica de novo quando o onclick nativo já abriu a conversa", async () => {
    const test = runOpen("Ana Silva", () => ["Ana Silva"], "Ana Silva");
    expect(await test.result).toBe(true);
    expect(test.clicked).toEqual([]);
  });

  it("aguarda a lista renderizar depois do foco", async () => {
    vi.useFakeTimers();
    try {
      let names: string[] = [];
      const test = runOpen("Ana Silva", () => names);
      names = ["Ana Silva"];
      await vi.advanceTimersByTimeAsync(200);
      expect(await test.result).toBe(true);
      expect(test.clicked).toEqual(["Ana Silva"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([["Ana Silva"], ["Ana", "Ana"]])(
    "não abre nome parcial ou homônimo: %j",
    async (...names) => {
      vi.useFakeTimers();
      try {
        const test = runOpen("Ana", () => names);
        await vi.runAllTimersAsync();
        expect(await test.result).toBe(false);
        expect(test.clicked).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    },
  );
});

describe("showNotification da página", () => {
  it("fica calado na reunião e esconde a prévia com PIN", async () => {
    const shown: Array<{ title: string; body?: string }> = [];
    class Registration {}
    (Registration.prototype as unknown as Record<string, unknown>)["showNotification"] = function (
      title: string,
      options?: { body?: string },
    ) {
      shown.push({ title, ...(options?.body ? { body: options.body } : {}) });
      return Promise.resolve();
    };
    const win: Record<string, unknown> = {
      Notification: Object.assign(function () {}, {
        permission: "granted",
        requestPermission: () => Promise.resolve("granted"),
      }),
      ServiceWorkerRegistration: Registration,
    };
    const run = (settings: Record<string, unknown>) => {
      delete win["__adrNotifGuard"];
      const script = buildNotificationGuard(JSON.stringify({ enabled: true, ...settings }), "gm-1");
      new Function("window", "document", "console", "location", `return ${script}`)(
        win,
        { querySelectorAll: () => [] },
        { log: () => undefined },
        { hostname: "mail.google.com" },
      );
    };
    run({ meetingQuiet: true });
    const registration = new Registration() as { showNotification: (t: string, o?: object) => Promise<void> };
    await registration.showNotification("Novo e-mail", { body: "assunto" });
    expect(shown).toEqual([]);
    (win["__adrNotifSettings"] as Record<string, unknown>)["meetingQuiet"] = false;
    (win["__adrNotifSettings"] as Record<string, unknown>)["hidePreview"] = true;
    await registration.showNotification("Novo e-mail", { body: "assunto" });
    expect(shown).toEqual([{ title: "Novo e-mail", body: "Nova mensagem" }]);
  });
});
