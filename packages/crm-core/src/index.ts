export { DEFAULT_BASE_URL, normalizeAllowedBaseUrl, mapHttpStatusToCrmErrorCode } from "./base-url.js";
export {
  chatKey,
  isRealName,
  isSameComposerText,
  normalizeComposerText,
  normalizeText,
  normalizeTitle,
  normalizeTranscriptCache,
  titleParts,
  upsertTranscriptCache,
  TRANSCRIPT_CACHE_LIMIT,
  TRANSCRIPT_CACHE_TTL_MS,
} from "./transcript-cache.js";
export { scoreLookupContact, disambiguateContacts } from "./lookup-score.js";
export { sanitizeLookupResult, emptyLookupResult } from "./lookup-sanitize.js";
export { normalizeQuickRepliesPayload, planSafeQuickReplyInsert } from "./quick-replies.js";
export {
  beginTranslate,
  completeTranslate,
  failTranslate,
  cancelTranslate,
  normalizeTranscribeResult,
  readCachedTranscript,
  writeCachedTranscript,
  applyCrmPanelKillSwitch,
  shouldMountCrmPanel,
  type TranslateState,
  type TranscribeState,
  type CrmPanelKillSwitch,
} from "./panel-ops.js";
export {
  assertPersonalCrmSession,
  buildPersonalCrmHeaders,
  whoamiFromSessionApi,
  whoamiFromAuthMeApi,
  whoamiFromError,
  CrmAuthError,
  type CrmSessionCookies,
  type PersonalCrmAuth,
  type WhoamiData,
} from "./auth-session.js";
export {
  identityFromWhatsAppChat,
  wrapChatIdentityResult,
  CHAT_IDENTITY_PROBE,
  chatDisplayName,
} from "./chat-identity.js";
