import { z } from "zod";

export const serviceKindSchema = z.enum([
  "whatsapp",
  "gmail",
  "calendar",
  "drive",
  "notion",
  "trello",
  "chatgpt",
  "claude",
  "gemini",
  "youtube",
  "spotify",
  "browser",
  "instagram",
  "tiktok",
  "meet",
  "outlook",
  "teams",
]);

export type ServiceKind = z.infer<typeof serviceKindSchema>;

export const crmCommandSchema = z.enum([
  "whoami",
  "lookup",
  "getChatIdentity",
  "translate",
  "transcribeMessage",
  "quickReplies",
  "getTranscriptCache",
  "cacheTranscript",
  "openCrm",
  "openSettings",
]);

export type CrmCommand = z.infer<typeof crmCommandSchema>;

export const CRM_COMMANDS = crmCommandSchema.options;

export function isCrmCommand(value: string): value is CrmCommand {
  return crmCommandSchema.safeParse(value).success;
}

export const crmErrorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "INVALID_REQUEST",
  "NETWORK",
  "RATE_LIMITED",
  "UPSTREAM_ERROR",
  "UNSUPPORTED",
]);

export type CrmErrorCode = z.infer<typeof crmErrorCodeSchema>;

export function crmResultSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data: dataSchema }),
    z.object({
      ok: z.literal(false),
      code: crmErrorCodeSchema,
      message: z.string(),
      retryAfterMs: z.number().int().nonnegative().optional(),
    }),
  ]);
}

export type CrmResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: CrmErrorCode;
      message: string;
      retryAfterMs?: number;
    };

export const chatIdentitySchema = z.object({
  id: z.string().nullable(),
  phone: z.string().nullable(),
  isGroup: z.boolean(),
  /** Título da conversa quando é mesmo um nome — ver chatDisplayName. Opcional:
   *  extensão antiga não manda o campo, e o resultado dela ainda tem que passar. */
  name: z.string().nullable().default(null),
});

export type ChatIdentity = z.infer<typeof chatIdentitySchema>;

export const whoamiDataSchema = z.object({
  hasCrm: z.boolean(),
  scope: z.string().optional(),
});

export const lookupRequestSchema = z.object({
  phone: z.string().optional(),
  name: z.string().optional(),
  scope: z.string().optional(),
});

export const lookupContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Número do contato no CRM: monta o link /contatos/<número> do painel. */
  number: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  company: z
    .object({
      id: z.string(),
      number: z.string().nullable().optional(),
      name: z.string(),
    })
    .nullable()
    .optional(),
});

export const lookupDealSchema = z.object({
  id: z.string(),
  number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  valueCents: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  ownerDisplayName: z.string().nullable().optional(),
  stage: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
});

export const lookupProjectSchema = z.object({
  id: z.string(),
  title: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
});

export const lookupDataSchema = z.object({
  deals: z.array(lookupDealSchema),
  contacts: z.array(lookupContactSchema),
  projects: z.array(lookupProjectSchema),
  warnings: z.array(z.string()).default([]),
});

export type LookupData = z.infer<typeof lookupDataSchema>;

export const translateRequestSchema = z.object({
  text: z.string(),
  target: z.string().min(2),
});

export const translateDataSchema = z.object({
  translatedText: z.string().nullable(),
  sourceLanguage: z.string().nullable().optional(),
});

export const transcribeRequestSchema = z.object({
  externalId: z.string().min(1),
  remoteJid: z.string().optional(),
});

export const transcribeDataSchema = z.object({
  status: z.string().nullable(),
  text: z.string().nullable(),
  error: z.string().nullable().optional(),
});

export const quickReplyTemplateSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  body: z.string().optional(),
  text: z.string().optional(),
});

export const quickRepliesDataSchema = z.object({
  templates: z.array(quickReplyTemplateSchema),
});

export type QuickRepliesData = z.infer<typeof quickRepliesDataSchema>;

export const transcriptCacheRequestSchema = z.object({
  scope: z.string().min(1).max(200),
});

export const cacheTranscriptRequestSchema = z.object({
  scope: z.string().min(1).max(200),
  externalId: z.string().min(1),
  text: z.string().min(1),
});

export const getChatIdentityDataSchema = z.object({
  chat: chatIdentitySchema.nullable(),
});

/** Message envelopes matching extension 0.12.5 runtime `type` field. */
export const extensionMessageTypeSchema = z.enum([
  "whoami",
  "lookup",
  "getChatIdentity",
  "translate",
  "transcribeMessage",
  "quickReplies",
  "getTranscriptCache",
  "cacheTranscript",
  "ping",
  "openOptions",
]);

export type ExtensionMessageType = z.infer<typeof extensionMessageTypeSchema>;

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  icon: z.string().optional(),
  crmProfileId: z.string(),
  serviceInstanceIds: z.array(z.string()),
  /** Index (0-based, among serviceInstanceIds) where the CRM tile sits in the sidebar rail. */
  crmPosition: z.number().int().min(0).default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Soft-delete timestamp; recoverable for 30 days. */
  deletedAt: z.string().optional(),
});

export type Workspace = z.infer<typeof workspaceSchema>;

export const serviceInstanceSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  kind: serviceKindSchema,
  name: z.string(),
  startUrl: z.string(),
  profileId: z.string(),
  pinned: z.boolean(),
  keepAwake: z.boolean(),
  hibernateAfterMinutes: z.number().int().min(1).max(1440).optional().catch(undefined),
  deletedAt: z.string().optional(),
});

export type ServiceInstance = z.infer<typeof serviceInstanceSchema>;

export const profileSchema = z.object({
  id: z.string(),
  kind: z.enum(["whatsapp", "google", "browser", "crm", "instagram", "microsoft"]),
  name: z.string(),
  partitionName: z.string(),
  createdAt: z.string(),
});

export type Profile = z.infer<typeof profileSchema>;

export const notificationSettingsSchema = z.object({
  /** Master switch for desktop notifications. */
  enabled: z.boolean().default(true),
  /** If true, muted WhatsApp chats never raise system notifications. */
  respectWhatsAppMute: z.boolean().default(true),
  /** Per service-instance id; missing means inherit enabled. */
  serviceEnabled: z.record(z.boolean()).default({}),
  /** Contagem de não lidos no ícone da barra de tarefas. */
  trayBadge: z.boolean().default(true),
  /** Não perturbe fora do horário configurado abaixo. */
  quietHours: z.boolean().default(false),
  /** Hora em que o silêncio COMEÇA (0–23). Default mantém o 19h de antes. */
  quietFromHour: z.number().int().min(0).max(23).default(19),
  /** Hora em que o silêncio TERMINA (0–23). Default mantém o 8h de antes. */
  quietToHour: z.number().int().min(0).max(23).default(8),
});

export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export const sidebarPositionSchema = z.enum(["left", "right", "top", "bottom"]);
export type SidebarPosition = z.infer<typeof sidebarPositionSchema>;

export const browserToolbarPositionSchema = z.enum(["top", "bottom"]);
export type BrowserToolbarPosition = z.infer<typeof browserToolbarPositionSchema>;

export const externalBrowserPreferenceSchema = z.enum(["auto", "brave", "chrome"]);
export type ExternalBrowserPreference = z.infer<typeof externalBrowserPreferenceSchema>;

// Valor de enum/faixa que esta versão não conhece (gravado por uma versão mais
// nova antes de um downgrade) cai no padrão: reprovar o estado inteiro mandava
// tudo para a quarentena — app vazio e todas as contas deslogadas.
export const appSettingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).catch("system"),
  sidebarExpanded: z.boolean(),
  sidebarPosition: sidebarPositionSchema.default("left").catch("left"),
  browserToolbarPosition: browserToolbarPositionSchema.default("top").catch("top"),
  uiScale: z.number().min(0.8).max(2).catch(1),
  maxLoadedViews: z.number().int().positive().optional(),
  adBlockEnabled: z.boolean().default(true),
  adBlockAllowlist: z.array(z.string()).default([]),
  preferredExternalBrowser: externalBrowserPreferenceSchema.default("auto").catch("auto"),
  /** Áudio da aba do CRM silenciado (o CRM não é ServiceInstance, mora aqui). */
  crmAudioMuted: z.boolean().default(false),
  /** PIN fica cifrado fora deste estado; aqui só fica a preferência de ativação. */
  whatsappLockEnabled: z.boolean().default(false),
  /** Bloqueio e relock por id de sessão WhatsApp; PINs ficam em cofres separados. */
  whatsappLockServiceIds: z.record(z.boolean()).default({}),
  whatsappLockOnLeaveServiceIds: z.record(z.boolean()).default({}),
  whatsappLockTimeoutMinutes: z.number().int().min(0).max(1440).default(30),
  /** Tempo de relock por sessão; ausência herda o valor global legado acima. */
  whatsappLockTimeoutServiceMinutes: z.record(z.number().int().min(0).max(1440)).default({}),
  /** E-mail usado como `authuser` ao abrir o formulário do Google Contacts.
   *  Só uma dica de qual conta abrir — não há credencial guardada. */
  contactsGoogleAccount: z.string().optional(),
  /** "Permitir" já dado pelo usuário, por `origem|permissão` (ver permissionGrantKey).
   *  O Chromium guardaria isso sozinho, mas `setPermissionRequestHandler` substitui
   *  esse mecanismo inteiro — sem guardar aqui, o diálogo volta a cada uso.
   *  Só o SIM entra: negar continua valendo uma vez, para que um clique errado não
   *  vire um "não" permanente sem tela nenhuma para desfazer. */
  permissionGrants: z.record(z.boolean()).default({}),
  /** "Limpar notificações" por serviço: quantas não lidas havia ao limpar. O
   *  contador mostra só o que passar disso (ver unreadAfterClear). */
  clearedUnread: z.record(z.number().int().min(0)).default({}),
  /** WhatsApp e Gmail não hibernam por ociosidade: hibernados, não notificam nem
   *  atualizam o contador. Sob pressão crítica de RAM ainda podem ceder. */
  keepMessengersAwake: z.boolean().default(true),
  /** Google Meet: silenciar avisos de WhatsApp/Gmail enquanto você está numa chamada. */
  meetQuietNotifications: z.boolean().default(true),
  /** Google Meet: mini-janela da chamada ao trocar de serviço durante a reunião. */
  meetMiniWindow: z.boolean().default(true),
  /** Google Meet: atalho global Ctrl+Alt+M liga/desliga o microfone durante a chamada. */
  meetMuteShortcut: z.boolean().default(true),
  /** Google Meet: ao sair da chamada, oferecer registro da reunião no CRM. */
  meetLogToCrm: z.boolean().default(true),
  /** Endereço iCal secreto do Google Calendar, cifrado com safeStorage (base64).
   *  É uma credencial de leitura da agenda: nunca vai em claro para o disco. */
  calendarFeedSealed: z.string().optional(),
  /** Minutos de antecedência do lembrete de reunião (0 = desligado). */
  calendarReminderMinutes: z.number().int().min(0).max(30).default(1).catch(1),
  notifications: notificationSettingsSchema.default({
    enabled: true,
    respectWhatsAppMute: true,
    serviceEnabled: {},
    trayBadge: true,
    quietHours: false,
    quietFromHour: 19,
    quietToHour: 8,
  }),
})
  // Campo de versão mais nova sobrevive a uma versão mais velha abrir e gravar.
  .passthrough();

export type AppSettings = z.infer<typeof appSettingsSchema>;

export const appStateV1Schema = z.object({
  schemaVersion: z.literal(1),
  /**
   * Migrações de DADOS já aplicadas, por id. Migração que conserta um default
   * antigo precisa rodar UMA vez: sem este registro ela desfaria, a cada boot, a
   * escolha do usuário (ex.: desligar "manter sempre ativo" no YouTube).
   */
  migrations: z.array(z.string()).default([]),
  workspaces: z.array(workspaceSchema),
  services: z.array(serviceInstanceSchema),
  profiles: z.array(profileSchema),
  activeWorkspaceId: z.string().optional(),
  activeServiceId: z.string().optional(),
  settings: appSettingsSchema,
  /**
   * Serviços e perfis de um tipo que ESTA versão não conhece — o arquivo foi
   * gravado por uma versão mais nova (ex.: TikTok aberto num build anterior).
   * Ficam guardados intactos, fora das listas ativas, em vez de invalidar o
   * arquivo inteiro: antes disso, voltar uma versão recomeçava o app do zero
   * (workspace e partições novas = deslogado de tudo). Ver parseAppState.
   */
  parkedServices: z.array(z.record(z.unknown())).default([]),
  parkedProfiles: z.array(z.record(z.unknown())).default([]),
})
  .passthrough();

export type AppStateV1 = z.infer<typeof appStateV1Schema>;

export function mapExtensionErrorCode(code: string | undefined, status?: number): CrmErrorCode {
  if (code === "NOT_CONFIGURED" || status === 401) return "UNAUTHENTICATED";
  if (code === "FORBIDDEN" || status === 403) return "FORBIDDEN";
  if (code === "IMPERSONATION_UNSUPPORTED") return "UNSUPPORTED";
  if (code === "NETWORK_ERROR" || code === "TIMEOUT" || status === 503 || status === 504) {
    return "NETWORK";
  }
  if (status === 429) return "RATE_LIMITED";
  if (status === 400 || status === 422 || code === "INVALID_REQUEST") return "INVALID_REQUEST";
  return "UPSTREAM_ERROR";
}
