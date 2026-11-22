import { randomUUID } from "node:crypto";
import type { AppStateV1, ServiceKind } from "@adr/contracts";
import { createEmptyAppState, parseAppState } from "@adr/app-state";
import { createWorkspace, listActiveWorkspaces } from "@adr/workspaces";
import {
  addWhatsAppInstance,
  addInstagramInstance,
  addGmailAndCalendar,
  addGoogleAccountService,
  addMicrosoftService,
  addStandaloneService,
  createServiceInstance,
  ensureWorkspaceGoogleProfile,
  migrateServicesToSharedGoogleProfile,
  usesSharedGoogleSession,
  usesSharedMicrosoftSession,
  SERVICE_PRESETS,
  ownsSession,
  usesStandaloneLogin,
} from "@adr/service-adapters";

export type CatalogItem = {
  kind: ServiceKind;
  name: string;
  available: boolean;
  note?: string;
};

export const SERVICE_CATALOG: CatalogItem[] = [
  { kind: "whatsapp", name: "WhatsApp", available: true },
  { kind: "gmail", name: "Gmail", available: true },
  { kind: "calendar", name: "Calendar", available: true },
  {
    kind: "drive",
    name: "Drive",
    available: true,
    note: "Mesma sessão Google do workspace",
  },
  {
    kind: "notion",
    name: "Notion",
    available: true,
    note: "Login próprio; pode adicionar mais de uma conta",
  },
  {
    kind: "trello",
    name: "Trello",
    available: true,
    note: "Login próprio; cada conta mantém sua sessão",
  },
  {
    kind: "chatgpt",
    name: "ChatGPT",
    available: true,
    note: "Login próprio; cada conta mantém sua sessão",
  },
  {
    kind: "claude",
    name: "Claude",
    available: true,
    note: "Login próprio; cada conta mantém sua sessão",
  },
  {
    kind: "gemini",
    name: "Gemini",
    available: true,
    note: "Mesma sessão Google do workspace",
  },
  {
    kind: "meet",
    name: "Google Meet",
    available: true,
    note: "Mesma sessão Google do workspace; câmera, microfone e apresentação de tela",
  },
  {
    kind: "youtube",
    name: "YouTube",
    available: true,
    note: "Mesma sessão Google do workspace",
  },
  {
    kind: "spotify",
    name: "Spotify",
    available: true,
    note: "Mesma sessão Google do workspace",
  },
  {
    kind: "browser",
    name: "ADR Browser",
    available: true,
    note: "Mesma sessão Google do workspace",
  },
  {
    kind: "instagram",
    name: "Instagram",
    available: true,
    note: "Conta própria; pode adicionar mais de uma",
  },
  {
    kind: "tiktok",
    name: "TikTok",
    available: true,
    note: "Login próprio; cada conta mantém sua sessão",
  },
  {
    kind: "outlook",
    name: "Outlook",
    available: true,
    note: "Mesma conta Microsoft do Teams; pode adicionar outra conta",
  },
  {
    kind: "teams",
    name: "Teams",
    available: true,
    note: "Mesma conta Microsoft do Outlook; câmera, microfone e apresentação de tela",
  },
];

/**
 * Serviço de mídia nasce "sempre ativo": hibernar no meio do vídeo/música é bug,
 * não economia de RAM. Regra em UM lugar — o default de criação (todos os
 * caminhos) e a migração abaixo têm que concordar.
 */
export function defaultKeepAwake(kind: ServiceKind): boolean {
  return kind === "youtube" || kind === "spotify";
}

/**
 * Serviço cujo valor é tocar mídia: sob pressão de RAM, o pin "manter sempre
 * ativo" só segura a aba enquanto ela toca som. O TikTok entra aqui mas não no
 * default acima: é pesado e o usuário raramente o deixa tocando em segundo plano.
 */
export function isMediaKind(kind: ServiceKind): boolean {
  return defaultKeepAwake(kind) || kind === "tiktok";
}

export const KEEP_AWAKE_MEDIA_MIGRATION = "keep-awake-media";

/**
 * O default acima só existe desde jul/2026: quem já tinha YouTube/Spotify criado
 * ficou com `keepAwake: false` e via a aba ser hibernada no meio do vídeo — por
 * ociosidade (o relógio corre desde o último clique nela, não desde o play) ou
 * por pressão de RAM, que encurta o prazo para 3 min ou 1 min.
 * Roda UMA vez e registra: desligar "manter sempre ativo" é escolha legítima do
 * usuário, e sem o registro esta função a desfaria a cada boot.
 */
export function migrateKeepAwakeForMedia(state: AppStateV1): AppStateV1 {
  if (state.migrations.includes(KEEP_AWAKE_MEDIA_MIGRATION)) return state;
  return parseAppState({
    ...state,
    migrations: [...state.migrations, KEEP_AWAKE_MEDIA_MIGRATION],
    services: state.services.map((service) =>
      defaultKeepAwake(service.kind) ? { ...service, keepAwake: true } : service,
    ),
  });
}

export const KEEP_AWAKE_MESSENGERS_MIGRATION = "keep-awake-messengers";

/**
 * "Manter WhatsApp, Gmail, Outlook e Teams sempre ativos" era uma chave global
 * que passava por cima do "Manter em memória" de cada serviço: o Outlook dizia
 * "pode hibernar" e nunca hibernava. Agora vale a escolha de cada serviço; quem
 * tinha a chave ligada fica com os quatro em memória, como estava. Roda uma vez.
 */
export function migrateKeepAwakeForMessengers(state: AppStateV1): AppStateV1 {
  if (state.migrations.includes(KEEP_AWAKE_MESSENGERS_MIGRATION)) return state;
  const keepAll = state.settings.keepMessengersAwake !== false;
  return parseAppState({
    ...state,
    migrations: [...state.migrations, KEEP_AWAKE_MESSENGERS_MIGRATION],
    services: state.services.map((service) =>
      keepAll && isMessengerKind(service.kind) ? { ...service, keepAwake: true } : service,
    ),
  });
}

export function ensureDefaultWorkspaceState(state: AppStateV1): AppStateV1 {
  // The default applies only when the setting is absent. Never rewrite a saved choice.
  let next = migrateKeepAwakeForMessengers(
    migrateKeepAwakeForMedia(migrateServicesToSharedGoogleProfile(state)),
  );
  const needsWorkspace = listActiveWorkspaces(next).length === 0;
  if (needsWorkspace) {
    next = createWorkspace(next, {
      name: "Principal",
      color: "#4da3ff",
      // A recreated workspace must not inherit the CRM session of a deleted one.
      crmProfileId: next.workspaces.length ? randomUUID() : "crm-default",
    });
  }
  const activeWorkspaces = listActiveWorkspaces(next);
  const workspaceId =
    activeWorkspaces.find((workspace) => workspace.id === next.activeWorkspaceId)?.id ||
    activeWorkspaces[0]!.id;
  // Seed WhatsApp only for a newly created workspace. Recreating it on every
  // boot after the user removed it violates the saved service selection.
  if (needsWorkspace) {
    next = addWhatsAppInstance(next, { workspaceId, name: "WhatsApp" });
  }
  if (next.activeWorkspaceId !== workspaceId) {
    next = parseAppState({ ...next, activeWorkspaceId: workspaceId });
  }
  return next;
}

export function bootstrapAppState(): AppStateV1 {
  return ensureDefaultWorkspaceState(createEmptyAppState());
}

export function addServiceToWorkspace(
  state: AppStateV1,
  kind: ServiceKind,
  name?: string,
  opts: { newGoogleAccount?: boolean } = {},
): AppStateV1 {
  const workspaceId = state.activeWorkspaceId || state.workspaces[0]?.id;
  if (!workspaceId) throw new Error("workspace ausente");
  const catalog = SERVICE_CATALOG.find((c) => c.kind === kind);
  if (!catalog?.available) throw new Error(`${kind} ainda não disponível`);

  // Segunda conta Google: sessão nova e isolada, não a do workspace. Login
  // limpo em partição nova é o que o Google menos rejeita em navegador
  // embutido (ver chrome-session.ts), por isso não reusamos a sessão atual.
  if (opts.newGoogleAccount && usesSharedGoogleSession(kind)) {
    const count = state.services.filter(
      (s) => s.workspaceId === workspaceId && s.kind === kind && !s.deletedAt,
    ).length;
    const presetName = SERVICE_PRESETS.find((p) => p.kind === kind)?.name || kind;
    return addGoogleAccountService(state, {
      workspaceId,
      kind,
      name: name?.trim() || `${presetName} ${count + 1}`,
      keepAwake: defaultKeepAwake(kind) || isMessengerKind(kind),
    }).state;
  }

  // Outlook/Teams: conta Microsoft do workspace; "outra conta" (o mesmo flag
  // da conta Google) cria uma conta Microsoft nova, com login do zero.
  if (usesSharedMicrosoftSession(kind)) {
    const count = state.services.filter(
      (s) => s.workspaceId === workspaceId && s.kind === kind && !s.deletedAt,
    ).length;
    const presetName = SERVICE_PRESETS.find((p) => p.kind === kind)?.name || kind;
    return addMicrosoftService(state, {
      workspaceId,
      kind,
      name: name?.trim() || (count === 0 ? presetName : `${presetName} ${count + 1}`),
      newAccount: Boolean(opts.newGoogleAccount),
    });
  }

  if (kind === "whatsapp") {
    const count = state.services.filter(
      (s) => s.workspaceId === workspaceId && s.kind === "whatsapp" && !s.deletedAt,
    ).length;
    return addWhatsAppInstance(state, {
      workspaceId,
      name: name?.trim() || (count === 0 ? "WhatsApp" : `WhatsApp ${count + 1}`),
    });
  }

  if (kind === "instagram") {
    // Own login per account, same as WhatsApp — supports multiple accounts.
    const count = state.services.filter(
      (s) => s.workspaceId === workspaceId && s.kind === "instagram" && !s.deletedAt,
    ).length;
    return addInstagramInstance(state, {
      workspaceId,
      name: name?.trim() || (count === 0 ? "Instagram" : `Instagram ${count + 1}`),
    });
  }

  if (usesStandaloneLogin(kind)) {
    // Sessão própria por conta; não misturar logins Atlassian/Notion/ChatGPT/Claude com Google
    // nem derrubar uma conta ao abrir outra no mesmo workspace.
    const count = state.services.filter(
      (s) => s.workspaceId === workspaceId && s.kind === kind && !s.deletedAt,
    ).length;
    const presetName = SERVICE_PRESETS.find((preset) => preset.kind === kind)?.name || kind;
    return addStandaloneService(state, {
      workspaceId,
      kind,
      name: name?.trim() || (count === 0 ? presetName : `${presetName} ${count + 1}`),
    });
  }

  if (kind === "gmail" || kind === "calendar") {
    const hasKind = state.services.some(
      (s) => s.workspaceId === workspaceId && s.kind === kind && !s.deletedAt,
    );
    if (hasKind) throw new Error(`${kind} já adicionado neste workspace`);

    const hasGoogleBundle = state.services.some(
      (s) =>
        s.workspaceId === workspaceId &&
        (s.kind === "gmail" || s.kind === "calendar") &&
        !s.deletedAt,
    );
    if (!hasGoogleBundle && (kind === "gmail" || kind === "calendar")) {
      const other = kind === "gmail" ? "calendar" : "gmail";
      const hasOther = state.services.some(
        (s) => s.workspaceId === workspaceId && s.kind === other && !s.deletedAt,
      );
      if (!hasOther) {
        return addGmailAndCalendar(state, workspaceId);
      }
    }

    const ensured = ensureWorkspaceGoogleProfile(state, workspaceId);
    const input: {
      workspaceId: string;
      kind: "gmail" | "calendar";
      profileId: string;
      name?: string;
    } = {
      workspaceId,
      kind,
      profileId: ensured.profile.id,
    };
    const presetName = SERVICE_PRESETS.find((p) => p.kind === kind)?.name;
    if (name) input.name = name;
    else if (presetName) input.name = presetName;
    return createServiceInstance(ensured.state, input);
  }

  if (usesSharedGoogleSession(kind)) {
    const hasKind = state.services.some(
      (s) => s.workspaceId === workspaceId && s.kind === kind && !s.deletedAt,
    );
    if (hasKind && kind !== "browser") {
      // Allow multiple browsers later; YouTube/Spotify stay one per workspace for now.
      throw new Error(`${kind} já adicionado neste workspace`);
    }
    const ensured = ensureWorkspaceGoogleProfile(state, workspaceId);
    const presetName = SERVICE_PRESETS.find((p) => p.kind === kind)?.name;
    return createServiceInstance(ensured.state, {
      workspaceId,
      kind,
      profileId: ensured.profile.id,
      name: name?.trim() || presetName || kind,
      keepAwake: defaultKeepAwake(kind) || isMessengerKind(kind),
    });
  }

  throw new Error(`${kind} ainda não disponível`);
}

export function duplicateServiceInWorkspace(
  state: AppStateV1,
  serviceId: string,
  opts: { newGoogleAccount?: boolean } = {},
): { state: AppStateV1; duplicatedId: string } {
  const source = state.services.find((service) => service.id === serviceId && !service.deletedAt);
  if (!source) throw new Error("serviço inexistente");

  const duplicateName = opts.newGoogleAccount || usesStandaloneLogin(source.kind)
    ? `${source.name} (outra conta)`
    : `${source.name} (cópia)`;
  const next =
    ownsSession(source.kind) || opts.newGoogleAccount
      ? addServiceToWorkspace(
          parseAppState({ ...state, activeWorkspaceId: source.workspaceId }),
          source.kind,
          duplicateName,
          opts,
        )
      : createServiceInstance(state, {
          workspaceId: source.workspaceId,
          kind: source.kind,
          profileId: source.profileId,
          name: duplicateName,
          startUrl: source.startUrl,
          pinned: source.pinned,
          keepAwake: source.keepAwake,
          hibernateAfterMinutes: source.hibernateAfterMinutes,
        });
  const duplicated = next.services.at(-1);
  if (!duplicated) throw new Error("falha ao duplicar serviço");
  return { state: next, duplicatedId: duplicated.id };
}

/** Serviços que avisam de mensagem nova: hibernados, não notificam nem contam. */
export function isMessengerKind(kind: ServiceKind | undefined): boolean {
  return kind === "whatsapp" || kind === "gmail" || kind === "outlook" || kind === "teams";
}

/**
 * Mensageiro com "Manter em memória" (escolha por serviço): não hiberna por
 * ociosidade nem pelo LRU. Em pressão CRÍTICA de RAM ainda cede: melhor perder
 * um aviso do que travar o computador.
 */
export function messengerStaysAwake(
  kind: ServiceKind | undefined,
  keepAwake: boolean,
  pressure: "normal" | "high" | "critical",
): boolean {
  return keepAwake && isMessengerKind(kind) && pressure !== "critical";
}
