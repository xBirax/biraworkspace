import { Menu, Notification, globalShortcut, net, type BaseWindow, type WebContents } from "electron";
import { MEET_IN_CALL_PROBE, MEET_TOGGLE_MIC, isMeetCallUrl, meetRoom } from "./meet.js";
import { popupChoice } from "./popup-choice.js";
import {
  MeetCallTracker,
  formatMeetingDuration,
  miniWindowBounds,
  type MeetCallEnded,
} from "./meet-calls.js";
import { calendarExpander, createCalendarScheduler } from "./calendar-scheduler.js";
import {
  dealFitsContact,
  dealsForContact,
  logMeetingToCrm,
  searchCrmContacts,
  type CrmCaller,
  type CrmContactMatch,
  type CrmDealMatch,
} from "./crm-meeting-log.js";

/**
 * Tudo que o app faz em volta de uma reunião do Google Meet:
 *
 * - sabe quem está NA chamada (sonda da página, ver meet.ts) e avisa transições;
 * - "não perturbe" de WhatsApp/Gmail durante a chamada;
 * - atalho global Ctrl+Alt+M para o microfone, só enquanto há chamada;
 * - mini-janela da chamada quando a pessoa troca de serviço no meio dela;
 * - ao sair, oferece registrar a reunião no CRM;
 * - lembrete antes das reuniões da agenda (endereço iCal secreto do Calendar).
 *
 * Saiu de workspace-window.ts: depende só do que recebe em `deps`.
 */

export const MEET_MUTE_ACCELERATOR = "CommandOrControl+Alt+M";
/** Reunião mais curta que isso (entrou e saiu) não vale registro no CRM. */
const MIN_LOGGED_CALL_MS = 2 * 60_000;
const PROBE_EVERY_MS = 10_000;
/** Sonda do Meet sem resposta em tanto tempo conta como falha (ver MAX_FAILED_PROBES). */
const PROBE_TIMEOUT_MS = 3000;
/**
 * Sondas seguidas sem resposta que encerram a chamada (1 min). Com 3, uma aba
 * ocupada apresentando a tela "saía" da reunião no meio dela.
 */
const MAX_FAILED_PROBES = 6;
/** Sonda pendente há mais que isso se perdeu (recarga da aba) e não bloqueia a próxima. */
const PROBE_LOST_MS = 30_000;
/** Quanto tempo um toast clicável (lembrete, registro no CRM) continua respondendo. */
const NOTIFICATION_TTL_MS = 2 * 60 * 60_000;

export type MeetIntegrationSettings = {
  meetQuietNotifications: boolean;
  meetMiniWindow: boolean;
  meetMuteShortcut: boolean;
  meetLogToCrm: boolean;
  calendarReminderMinutes: number;
  notificationsEnabled: boolean;
};

export type MeetIntegrationDeps = {
  parentWindow: BaseWindow;
  settings: () => MeetIntegrationSettings;
  /**
   * Abas de Meet de TODOS os workspaces ativos: [serviceId, webContents]. Trocar
   * de workspace não encerra a chamada do outro — antes ela "acabava" a cada
   * troca, com aviso de registro no CRM no meio da reunião.
   */
  meetViews: () => Array<[string, WebContents]>;
  /** Workspace do serviço (o CRM em que a reunião é registrada). */
  workspaceOf: (serviceId: string) => string | null;
  /** Mudou quem está em chamada: redesenhar (mini-janela) e reaplicar avisos. */
  onCallsChanged: () => void;
  /** Endereço iCal decifrado, ou null. */
  calendarFeedUrl: () => string | null;
  /** Há endereço salvo, mas ele não abre neste computador/usuário (safeStorage). */
  calendarFeedBroken: () => boolean;
  /** Abrir um link de reunião na aba do Meet (ou fora, sem aba do Meet). */
  openMeetingUrl: (url: string) => void;
  focusApp: () => void;
  /** null = cancelou; "" = confirmou em branco. */
  askText: (title: string, hint: string, label: string, options?: { initial?: string; okLabel?: string; allowEmpty?: boolean }) => Promise<string | null>;
  /** O status da agenda mudou: atualizar as telas. */
  onCalendarChanged: () => void;
  /** CRM do workspace informado. */
  callCrm: ((workspaceId: string, apiPath: string, init?: RequestInit) => Promise<unknown>) | null;
  disableCrmLogPrompt: () => void;
  toast: (text: string) => void;
  log: (level: "info" | "error", message: string, extra?: unknown) => void;
  /** App saindo: nada de oferecer registro no CRM nem redesenhar. */
  isQuitting: () => boolean;
  /** calendar-worker.bundle.cjs (fora do asar); "" = expandir aqui mesmo. */
  calendarWorkerPath: string;
};

export function createMeetIntegration(deps: MeetIntegrationDeps) {
  /** Última sonda "está NA chamada?" por aba, válida para aquela URL. */
  const callState = new WeakMap<WebContents, { url: string; inCall: boolean }>();
  /** Sondas seguidas sem resposta, por aba do Meet. */
  const failedProbes = new Map<string, number>();
  /** Aba com sonda ainda pendente: renderer travado não acumula uma a cada 10 s. */
  const probing = new WeakMap<WebContents, number>();
  /** Mini-janela escondida pela pessoa NESTA reunião (serviceId|sala). */
  const miniHidden = new Set<string>();
  /** Notificações vivas: sem referência, o coletor de lixo leva o "click" embora. */
  const liveNotifications = new Set<Notification>();
  let shortcutOn = false;
  let shortcutWarned = false;
  let disposed = false;
  /** Última reunião que vale registro: o menu do Meet a oferece mesmo sem o toast. */
  let lastLoggable: { call: MeetCallEnded; duration: string; workspaceId: string } | null = null;

  /**
   * Toast do Windows com clique. A referência fica viva até o clique (ou 2 h):
   * o toast que some da tela vai para a Central de Notificações e continua
   * clicável lá — soltando no "close", o clique de depois não fazia nada.
   */
  const showNotification = (options: Electron.NotificationConstructorOptions, onClick?: () => void): void => {
    if (disposed || !Notification.isSupported()) return;
    const notification = new Notification(options);
    liveNotifications.add(notification);
    const expire = setTimeout(() => liveNotifications.delete(notification), NOTIFICATION_TTL_MS);
    expire.unref?.();
    const release = (): void => {
      clearTimeout(expire);
      liveNotifications.delete(notification);
    };
    notification.on("click", () => {
      release();
      onClick?.();
    });
    notification.on("failed", release);
    notification.show();
  };

  const tracker = new MeetCallTracker({
    onStart: (call) => {
      deps.log("info", "meet chamada iniciada", { sala: call.room });
      shortcutWarned = false;
      syncShortcut();
      deps.onCallsChanged();
    },
    onEnd: (call) => {
      deps.log("info", "meet chamada encerrada", {
        sala: call.room,
        duracaoMin: Math.round((call.endedAt - call.startedAt) / 60_000),
      });
      miniHidden.delete(`${call.serviceId}|${call.room}`);
      syncShortcut();
      if (disposed) return;
      deps.onCallsChanged();
      offerCrmLog(call);
    },
  });

  /**
   * A aba está numa reunião? Sala sem sonda ainda (ou URL nova) conta como "sim":
   * melhor adiar uma hibernação do que derrubar alguém da chamada. A entrada
   * ("Pronto para participar?") e a saída ficam na mesma URL; quem decide é a
   * sonda.
   */
  function inCall(contents: WebContents | undefined): boolean {
    if (!contents || contents.isDestroyed()) return false;
    const url = contents.getURL();
    if (!isMeetCallUrl(url)) return false;
    const known = callState.get(contents);
    return known && known.url === url ? known.inCall : true;
  }

  /**
   * Sonda a página. Com `serviceId` (só o laço periódico passa), o resultado
   * também move o rastreador de chamadas; a hibernação só lê, para não abrir e
   * fechar chamadas fora de ordem.
   */
  async function probe(contents: WebContents, serviceId?: string): Promise<boolean> {
    const url = contents.getURL();
    if (!isMeetCallUrl(url)) {
      if (serviceId) {
        failedProbes.delete(serviceId);
        tracker.update(serviceId, "", false);
      }
      return false;
    }
    // Sonda anterior ainda sem resposta também conta como falha: aba travada de
    // vez nunca responde, e só contar no prazo de cada sonda parava em 1 — a
    // chamada nunca acabava.
    // Recarga no meio da sonda deixa o executeJavaScript pendente para sempre:
    // passado o prazo, ela conta como perdida e uma nova sonda sai.
    const since = probing.get(contents);
    if (since !== undefined && Date.now() - since < PROBE_LOST_MS) {
      if (serviceId && probeFailed(serviceId, contents)) return false;
      return inCall(contents);
    }
    const startedAt = Date.now();
    probing.set(contents, startedAt);
    let timer: NodeJS.Timeout | undefined;
    try {
      const pending = contents.executeJavaScript(MEET_IN_CALL_PROBE, true);
      // Sai do "pendente" quando a página responder, mesmo depois do prazo.
      void Promise.resolve(pending)
        .catch(() => undefined)
        .finally(() => {
          if (probing.get(contents) === startedAt) probing.delete(contents);
        });
      const result = Boolean(
        await Promise.race([
          pending,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("sonda do Meet sem resposta")), PROBE_TIMEOUT_MS);
          }),
        ]),
      );
      if (!contents.isDestroyed() && contents.getURL() === url) {
        callState.set(contents, { url, inCall: result });
        if (serviceId) {
          failedProbes.delete(serviceId);
          tracker.update(serviceId, meetRoom(url), result);
        }
      }
      return result;
    } catch {
      // Aba travada ou morta não responde nunca: sem teto, o "não perturbe", o
      // atalho e a mini-janela ficavam presos numa chamada que já acabou.
      if (serviceId && probeFailed(serviceId, contents)) return false;
      return inCall(contents);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Conta uma sonda sem resposta; true = chegou ao teto e a chamada foi encerrada. */
  function probeFailed(serviceId: string, contents: WebContents): boolean {
    const failures = (failedProbes.get(serviceId) ?? 0) + 1;
    failedProbes.set(serviceId, failures);
    if (failures < MAX_FAILED_PROBES) return false;
    failedProbes.delete(serviceId);
    // Fora da chamada também para a hibernação: sem isto ela lia o último "está
    // na chamada" (ou, sem registro, o "sim" de sala nunca sondada) e nunca
    // liberava a aba travada.
    if (!contents.isDestroyed()) callState.set(contents, { url: contents.getURL(), inCall: false });
    tracker.forget(serviceId);
    return true;
  }

  const probeTimer = setInterval(() => {
    const seen = new Set<string>();
    for (const [serviceId, contents] of deps.meetViews()) {
      seen.add(serviceId);
      if (contents.isDestroyed()) {
        tracker.forget(serviceId);
        continue;
      }
      void probe(contents, serviceId).catch(() => undefined);
    }
    // Aba do Meet que sumiu (hibernou/excluída) leva a chamada junto.
    for (const call of tracker.activeCalls()) if (!seen.has(call.serviceId)) tracker.forget(call.serviceId);
  }, PROBE_EVERY_MS);

  // ---- atalho global do microfone -------------------------------------------
  function toggleMic(): void {
    const target = deps
      .meetViews()
      .find(([serviceId, contents]) => tracker.isInCall(serviceId) && !contents.isDestroyed());
    if (!target) return;
    void target[1]
      .executeJavaScript(MEET_TOGGLE_MIC, true)
      .then((state: unknown) => {
        const text =
          state === "muted" ? "Microfone desligado" : state === "unmuted" ? "Microfone ligado" : "";
        if (!text) {
          deps.toast("Não achei o botão de microfone do Meet");
          return;
        }
        // Atalho global: o app pode estar atrás de outra janela.
        showNotification({ title: "Google Meet", body: text, silent: true });
        deps.toast(text);
      })
      .catch(() => undefined);
  }

  function syncShortcut(): void {
    const want = !disposed && tracker.active && deps.settings().meetMuteShortcut;
    if (want && !shortcutOn) {
      shortcutOn = globalShortcut.register(MEET_MUTE_ACCELERATOR, toggleMic);
      if (!shortcutOn && !shortcutWarned) {
        shortcutWarned = true;
        deps.log("info", "atalho do microfone ocupado por outro programa", {});
        deps.toast(
          `${MEET_MUTE_ACCELERATOR.replace("CommandOrControl", "Ctrl")} já é usado por outro programa: o atalho do microfone ficou desligado.`,
        );
      }
    } else if (!want && shortcutOn) {
      globalShortcut.unregister(MEET_MUTE_ACCELERATOR);
      shortcutOn = false;
    }
  }

  // ---- mini-janela -----------------------------------------------------------
  /**
   * Para onde vai a aba do Meet em chamada quando outra superfície está na
   * frente: canto inferior ESQUERDO. O direito tem o botão de enviar do WhatsApp
   * e o painel do CRM; à esquerda fica o fim da lista de conversas/marcadores.
   * `null` = sem mini-janela agora.
   */
  function miniWindowFor(
    activeServiceId: string | null,
    main: Electron.Rectangle,
  ): { serviceId: string; bounds: Electron.Rectangle } | null {
    if (!deps.settings().meetMiniWindow) return null;
    const bounds = miniWindowBounds(main);
    if (!bounds) return null;
    const call = tracker
      .activeCalls()
      .find((item) => item.serviceId !== activeServiceId && !miniHidden.has(`${item.serviceId}|${item.room}`));
    return call ? { serviceId: call.serviceId, bounds } : null;
  }

  function hideMiniForCurrentCall(serviceId: string): void {
    const call = tracker.activeCalls().find((item) => item.serviceId === serviceId);
    if (!call) return;
    miniHidden.add(`${call.serviceId}|${call.room}`);
    deps.onCallsChanged();
  }

  // ---- registro no CRM -------------------------------------------------------
  function offerCrmLog(call: MeetCallEnded): void {
    if (!deps.callCrm || !deps.settings().meetLogToCrm || deps.isQuitting()) return;
    if (call.endedAt - call.startedAt < MIN_LOGGED_CALL_MS) return;
    // O CRM é o do workspace da aba do Meet, fixado agora: clicar no aviso depois
    // de trocar de workspace não pode registrar no CRM errado.
    const workspaceId = deps.workspaceOf(call.serviceId);
    if (!workspaceId) return;
    const duration = formatMeetingDuration(call.endedAt - call.startedAt);
    lastLoggable = { call, duration, workspaceId };
    showNotification(
      {
        title: "Registrar a reunião no CRM?",
        body: `Reunião de ${duration} no Google Meet. Clique para escolher o contato.`,
      },
      () => {
        deps.focusApp();
        void registerInCrm(call, duration, workspaceId);
      },
    );
  }

  async function registerInCrm(call: MeetCallEnded, duration: string, workspaceId: string): Promise<void> {
    const crm = deps.callCrm;
    if (!crm) return;
    const callCrm: CrmCaller = (apiPath, init) => crm(workspaceId, apiPath, init);
    let hint = `Reunião de ${duration}. Busque o contato pelo nome, e-mail ou empresa.`;
    let term = "";
    let matches: Awaited<ReturnType<typeof searchCrmContacts>> = [];
    // Busca sem resultado reabre o campo com o termo: o aviso já foi embora, e
    // antes a única saída era desistir do registro.
    for (;;) {
      const answer = await deps.askText("Registrar reunião no CRM", hint, "Contato", { initial: term, okLabel: "Buscar" });
      if (answer === null) return;
      term = answer.trim();
      if (term.length < 2) {
        hint = "Digite pelo menos 2 letras do nome, e-mail ou empresa.";
        continue;
      }
      try {
        matches = await searchCrmContacts(callCrm, term);
      } catch (error) {
        deps.toast(`CRM indisponível: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      if (matches.length) break;
      hint = `Nenhum contato encontrado para "${term}". Tente outro nome, e-mail ou empresa.`;
    }
    Menu.buildFromTemplate([
      { label: "Registrar a reunião para…", enabled: false },
      { type: "separator" },
      ...matches.map((contact) => ({
        // Sem empresa fica clicável: o registro recusa com a explicação (a
        // atividade do CRM exige empresa), em vez de um item cinza sem motivo.
        label: `${contact.name}${contact.companyName ? ` — ${contact.companyName}` : " (sem empresa no CRM)"}`,
        click: () => void chooseDealAndLog(callCrm, call, duration, contact),
      })),
      { type: "separator" },
      { label: "Não perguntar mais depois das reuniões", click: () => deps.disableCrmLogPrompt() },
    ]).popup({ window: deps.parentWindow });
  }

  /**
   * Depois do contato: negócio (se ele tiver algum) e uma anotação opcional.
   * Sem negócio, a atividade vai para a empresa do contato.
   */
  async function chooseDealAndLog(
    callCrm: CrmCaller,
    call: MeetCallEnded,
    duration: string,
    contact: CrmContactMatch,
  ): Promise<void> {
    let deals: CrmDealMatch[] = [];
    try {
      deals = (await dealsForContact(callCrm, contact.id)).filter((deal) => dealFitsContact(deal, contact));
    } catch {
      // Sem acesso aos negócios (permissão): registra na empresa, como antes.
    }
    const deal = deals.length ? await pickDeal(deals) : null;
    if (deal === undefined) return; // fechou o menu: desistiu
    const note = await deps.askText(
      "Anotação da reunião (opcional)",
      `Vai para a atividade de ${contact.name}${deal ? ` em ${deal.title}` : ""}. Deixe em branco para registrar sem anotação.`,
      "Anotação",
      { okLabel: "Registrar", allowEmpty: true },
    );
    if (note === null) {
      deps.toast("Registro da reunião cancelado.");
      return;
    }
    try {
      await logMeetingToCrm(callCrm, {
        contact,
        room: call.room,
        startedAt: call.startedAt,
        durationLabel: duration,
        deal,
        ...(note ? { note } : {}),
      });
      deps.toast(`Reunião registrada no CRM: ${contact.name}${deal ? ` — ${deal.title}` : ""}`);
      deps.log("info", "meet registrado no crm", { duracao: duration, negocio: Boolean(deal) });
    } catch (error) {
      deps.toast(`Não foi possível registrar: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Menu de negócios. null = "sem negócio"; undefined = fechou sem escolher. */
  function pickDeal(deals: CrmDealMatch[]): Promise<CrmDealMatch | null | undefined> {
    return popupChoice<CrmDealMatch | null>(deps.parentWindow, [
      { header: "Vincular a reunião a um negócio?" },
      { separator: true },
      ...deals.map((deal) => ({ label: `${deal.title}${deal.stage ? ` (${deal.stage})` : ""}`, value: deal })),
      { separator: true },
      { label: "Sem negócio (só o contato e a empresa)", value: null },
    ]);
  }

  // ---- lembrete da agenda (calendar-scheduler.ts) ---------------------------
  const calendar = createCalendarScheduler({
    feedUrl: deps.calendarFeedUrl,
    feedBroken: deps.calendarFeedBroken,
    // net.fetch: a pilha de rede do Chromium, que respeita o proxy do sistema.
    fetch: (url, init) => net.fetch(url, init),
    expand: calendarExpander(deps.calendarWorkerPath),
    reminderMinutes: () => deps.settings().calendarReminderMinutes,
    notificationsEnabled: () => deps.settings().notificationsEnabled,
    notify: (meeting, minutes) =>
      showNotification(
        {
          title: minutes <= 0 ? "Reunião começando agora" : `Reunião em ${minutes} min`,
          body: `${meeting.title}${meeting.organizer ? `\nOrganizador: ${meeting.organizer}` : ""}\nClique para entrar no Google Meet.`,
        },
        () => {
          deps.focusApp();
          deps.openMeetingUrl(meeting.meetUrl);
        },
      ),
    onChanged: deps.onCalendarChanged,
    log: deps.log,
  });

  function dispose(): void {
    disposed = true;
    clearInterval(probeTimer);
    calendar.dispose();
    if (shortcutOn) globalShortcut.unregister(MEET_MUTE_ACCELERATOR);
    shortcutOn = false;
    liveNotifications.clear();
  }

  return {
    inCall,
    probe,
    /** Há alguém em chamada agora (para o "não perturbe" e a atualização). */
    anyCall: (): boolean => tracker.active,
    isServiceInCall: (serviceId: string): boolean => tracker.isInCall(serviceId),
    miniWindowFor,
    hideMiniForCurrentCall,
    syncShortcut,
    refreshCalendar: calendar.refresh,
    calendarStatus: calendar.status,
    /** Há reunião recente para o menu "Registrar a última reunião no CRM". */
    hasLoggableCall: (): boolean => Boolean(lastLoggable && deps.callCrm),
    registerLastCall: (): void => {
      if (lastLoggable) void registerInCrm(lastLoggable.call, lastLoggable.duration, lastLoggable.workspaceId);
    },
    /** Aba do Meet morta/recriada: a chamada dela acabou. */
    forget: (serviceId: string) => {
      failedProbes.delete(serviceId);
      tracker.forget(serviceId);
    },
    dispose,
  };
}

export type MeetIntegration = ReturnType<typeof createMeetIntegration>;
