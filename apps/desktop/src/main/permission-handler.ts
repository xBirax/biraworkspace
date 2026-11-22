import { BrowserWindow, dialog, type BaseWindow, type WebContents } from "electron";
import type { NotificationSettings } from "@adr/contracts";
import {
  allowPermissionCheck,
  decidePermission,
  grantNames,
  permissionPromptLabel,
} from "./permission-policy.js";
import { serviceNotificationsOn, shouldAllowServiceNotification } from "./notifications.js";

/**
 * Política de permissões de cada sessão (serviços, CRM, janela de login Google).
 *
 * Mesma política para toda view. A do CRM não existia: sem handler o Electron
 * concede quase tudo, e por isso o CRM era a única superfície sem como desligar
 * notificação. Saiu de workspace-window.ts: depende só do que recebe em `deps`.
 */
export type PermissionHandlerDeps = {
  parentWindow: BaseWindow;
  viewMeta: WeakMap<WebContents, { kind: string; workspaceId: string; serviceId?: string }>;
  isCrmUrl: (url: string) => boolean;
  crmSurfaceId: string;
  notificationSettings: () => NotificationSettings;
  /** A URL é do site do próprio serviço (não de uma página aberta dentro dele)? */
  isServiceOwnSite: (kind: string, url: string) => boolean;
  /** A aba da frente, com a janela em foco, pode abrir algo fora (ver pageMayOpen). */
  pageMayOpen: (contents: WebContents, url: string) => boolean;
  rememberedPermission: (origin: string, permission: string) => boolean | undefined;
  rememberPermission: (origin: string, permission: string) => void;
  /** Serviço dono de uma origem numa partição (service worker não tem webContents). */
  serviceOfOrigin: (partition: string, origin: string) => { id: string; kind: string } | undefined;
  /** WhatsApp/Gmail calados durante reunião do Meet. */
  meetingQuietFor: (serviceId: string) => boolean;
  log: (message: string, extra?: unknown) => void;
};

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

export function createPermissionHandler(deps: PermissionHandlerDeps) {
  /** Sessões que já têm a política (a janela de login Google confere). */
  const sessions = new WeakSet<Electron.Session>();

  function attach(
    ses: Electron.Session,
    partition: string,
    kind: string,
    notificationId: string,
    fallbackUrl: () => string,
  ): void {
    sessions.add(ses);
    ses.setPermissionRequestHandler((contents, permission, callback, details) => {
      // Gmail, Calendar, YouTube, Spotify e Browser dividem UMA sessão, e o
      // handler é por sessão: o último serviço criado sobrescrevia o de todos.
      // Quem pediu manda — os argumentos são só o fallback.
      const meta = deps.viewMeta.get(contents);
      const askingKind = meta?.kind || kind;
      const askingId = meta?.serviceId || notificationId;
      const url = details?.requestingUrl || contents.getURL() || fallbackUrl();
      if (permission === "notifications") {
        // Horário silencioso não entra aqui: negar a PÁGINA faz o site ler
        // "bloqueado" e mostrar "Ativar notificações"; o guard injetado já a cala.
        if (deps.isCrmUrl(url) || !serviceNotificationsOn(deps.notificationSettings(), askingId)) {
          callback(false);
          return;
        }
        // Serviço que o usuário escolheu (WhatsApp, Gmail, CRM…) segue só a chave
        // do app — no site DELE. Página de outro site aberta na aba (link,
        // redirecionamento) cai na regra geral abaixo, como o ADR Browser: antes
        // ela ganhava toast do Windows com a marca do app sem pergunta nenhuma.
        if (askingKind !== "browser" && deps.isServiceOwnSite(askingKind, url)) {
          callback(true);
          return;
        }
      }
      // Protocolo externo pedido por aba no fundo ou com a janela sem foco não
      // abre diálogo: uma página em laço empilhava avisos modais.
      // Popup em foco (fim de SSO que abre zoommtg:, msteams:) também é o usuário.
      const focusedPopup =
        !deps.viewMeta.has(contents) && Boolean(BrowserWindow.fromWebContents(contents)?.isFocused());
      if (permission === "openExternal" && !focusedPopup && !deps.pageMayOpen(contents, url)) {
        callback(false);
        return;
      }
      const decision = decidePermission(permission, url, askingKind);
      // Sem isto, uma permissão negada some sem rastro e o sintoma vira só
      // "o botão não faz nada". Aparece no export de diagnóstico.
      if (decision !== "ask") {
        deps.log("permission", { kind: askingKind, permission, decision });
        callback(decision === "allow");
        return;
      }
      const origin = originOf(url);
      // getDisplayMedia ("Apresentar agora") chega aqui ANTES do seletor de tela,
      // como "media" sem tipo de mídia. Perguntar "microfone/câmera?" era errado,
      // e o "Permitir" gravava um "media" que valeria para câmera e microfone.
      // Quem consente é o seletor (screen-share.ts); aqui só a regra do serviço.
      const requestedMedia = details && "mediaTypes" in details ? (details.mediaTypes ?? []) : undefined;
      if (permission === "media" && requestedMedia && requestedMedia.length === 0) {
        callback(decidePermission("display-capture", url, askingKind) !== "deny");
        return;
      }
      // Microfone e câmera são lembrados separadamente: "permitir" o microfone
      // para uma nota de voz não pode liberar a câmera do mesmo site depois.
      const grants = grantNames(permission, requestedMedia);
      // "media" lembrado antes da separação (0.1.49 ou anterior) continua valendo
      // para os dois: sem isto, todo WhatsApp perguntava o microfone de novo.
      const remembered =
        deps.rememberedPermission(origin, permission) === true ||
        grants.every((name) => deps.rememberedPermission(origin, name) === true)
          ? true
          : undefined;
      // Depois da consulta, não antes: com o log lá em cima ele imprimia
      // `decision: "ask"` mesmo quando ninguém chegou a ser perguntado.
      deps.log("permission", {
        kind: askingKind,
        permission,
        decision: remembered === undefined ? "ask" : "allow (lembrada)",
      });
      if (remembered !== undefined) {
        callback(remembered);
        return;
      }
      // Link externo: mostra O QUE vai abrir (o protocolo decide qual programa
      // roda) e não deixa o Enter aprovar sozinho.
      const externalUrl =
        permission === "openExternal" && details && "externalURL" in details
          ? String(details.externalURL || "")
          : "";
      void dialog
        .showMessageBox(deps.parentWindow, {
          type: "question",
          buttons: ["Negar", "Permitir"],
          defaultId: permission === "openExternal" ? 0 : 1,
          cancelId: 0,
          title: "Permissão",
          message: permissionPromptLabel(permission, origin),
          ...(externalUrl ? { detail: `Abrir: ${externalUrl.slice(0, 300)}` } : {}),
        })
        .then(({ response }) => {
          if (response === 1) for (const name of grants) deps.rememberPermission(origin, name);
          callback(response === 1);
        })
        .catch(() => callback(false));
    });

    /**
     * O handler acima só roda quando a página PEDE a permissão. Já concedida,
     * ela nunca mais é pedida — e notificação disparada de SERVICE WORKER
     * (`registration.showNotification`) nem passa pelo `window.Notification` da
     * página, então o guard injetado também não a alcança.
     *
     * O check handler é consultado a cada USO. Vindo do service worker não há
     * webContents (é null) e só resta a origem para saber de quem é.
     */
    ses.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
      const meta = contents ? deps.viewMeta.get(contents) : undefined;
      const crm = deps.isCrmUrl(requestingOrigin);
      // Sem webContents (service worker) e numa sessão de vários serviços, os
      // argumentos são do ÚLTIMO serviço criado: a origem diz de quem é.
      const byOrigin = !meta && !crm ? deps.serviceOfOrigin(partition, requestingOrigin) : undefined;
      const askingKind = meta?.kind || (crm ? "crm" : byOrigin?.kind || kind);
      const askingId = meta?.serviceId || (crm ? deps.crmSurfaceId : byOrigin?.id || notificationId);
      if (permission === "notifications") {
        if (crm || !serviceNotificationsOn(deps.notificationSettings(), askingId)) return false;
        // Service worker (sem webContents) o guard da página não alcança: o
        // horário silencioso vale só para ele, como o "não perturbe" da reunião.
        if (!contents && !shouldAllowServiceNotification(deps.notificationSettings(), askingId)) return false;
        // Sem webContents = service worker: o guard da página não o alcança,
        // então o "não perturbe" da reunião vale aqui. Só para ele: na página,
        // negar faria o site ler "bloqueado".
        if (!contents && byOrigin && deps.meetingQuietFor(byOrigin.id)) return false;
        if (askingKind !== "browser" && deps.isServiceOwnSite(askingKind, requestingOrigin)) return true;
        return deps.rememberedPermission(originOf(requestingOrigin), permission) === true;
      }
      // "ask" aqui vira true, não false — ver allowPermissionCheck. Traduzir
      // "ask" para negação matava o microfone do WhatsApp: o Chromium consulta
      // este check antes do getUserMedia e, com false, nega sem NUNCA chamar o
      // request handler que abriria o diálogo do app.
      const url = details?.requestingUrl || requestingOrigin || fallbackUrl();
      const mediaType = details && "mediaType" in details ? details.mediaType : undefined;
      const remembered = deps.rememberedPermission(
        originOf(url),
        grantNames(permission, mediaType === "audio" || mediaType === "video" ? [mediaType] : undefined)[0]!,
      );
      if (remembered !== undefined) return remembered;
      return allowPermissionCheck(permission, url, askingKind);
    });
  }

  return { attach, isAttached: (ses: Electron.Session): boolean => sessions.has(ses) };
}
