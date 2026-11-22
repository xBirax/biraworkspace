export const SERVICE_ADAPTERS_PACKAGE = "@adr/service-adapters";
export {
  SERVICE_PRESETS,
  getPreset,
  createServiceInstance,
  expectedAdapterFor,
  addStandaloneService,
  STANDALONE_LOGIN_KINDS,
  usesStandaloneLogin,
  ownsSession,
  type ServicePreset,
} from "./presets.js";
export {
  createWhatsAppProfile,
  addWhatsAppInstance,
  renameWhatsAppInstance,
  listWhatsAppInstances,
  softDeleteService,
  restoreDeletedService,
  partitionNamesForWhatsApps,
  assertWhatsAppPartitionsIsolated,
  updateWhatsAppBadge,
  unreadFromWhatsAppTitle,
  type WhatsAppBadge,
} from "./whatsapp-instances.js";
export { unreadFromGmailTitle } from "./gmail-badge.js";
export { unreadFromOutlookFolderTitle } from "./outlook-badge.js";
export {
  MICROSOFT_SESSION_KINDS,
  usesSharedMicrosoftSession,
  listMicrosoftProfilesForWorkspace,
  addMicrosoftService,
  renameMicrosoftProfile,
  reassignServiceMicrosoftProfile,
  type MicrosoftSessionKind,
} from "./microsoft-services.js";
export {
  createInstagramProfile,
  addInstagramInstance,
  renameInstagramInstance,
  listInstagramInstances,
  partitionNamesForInstagrams,
  assertInstagramPartitionsIsolated,
} from "./instagram-instances.js";
export {
  GOOGLE_SESSION_KINDS,
  usesSharedGoogleSession,
  isGoogleAuthDomain,
  GOOGLE_AUTH_ORIGINS,
  ensureWorkspaceGoogleProfile,
  addGmailAndCalendar,
  migrateServicesToSharedGoogleProfile,
  googlePartitionForWorkspace,
  assertGoogleIsolation,
  resolveGoogleEmbedMode,
  externalGoogleOpenUrl,
  createGoogleProfile,
  addGoogleAccountService,
  listGoogleProfilesForWorkspace,
  renameGoogleProfile,
  reassignServiceGoogleProfile,
  googlePartitionForProfile,
  type GoogleEmbedMode,
  type GoogleSessionKind,
} from "./google-services.js";
