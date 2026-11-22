export {
  validateCrmIpcRequest,
  CRM_PRELOAD_METHODS,
  viewKindAllowsCrmPreload,
  desktopCrmCommandSchema,
  type IpcSenderInfo,
  type IpcValidationResult,
  type DesktopCrmCommand,
  type CrmPreloadMethod,
  composerTranslateRequestSchema,
  validateComposerTranslateRequest,
  viewKindAllowsComposerPreload,
  type ComposerTranslateRequest,
} from "./ipc-guard.js";

export {
  crmPartitionForWorkspace,
  readCrmAuthCookies,
  writeCrmAuthCookies,
  logoutCrmSession,
  MemoryCookieStore,
  type CookieStore,
  type AuthCookies,
} from "./crm-auth.js";

export const CRM_DESKTOP_ADAPTER_PACKAGE = "@adr/crm-desktop-adapter";
