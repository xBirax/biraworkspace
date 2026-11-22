import {
  chatKey,
  isRealName,
  isSameComposerText,
  normalizeComposerText,
  normalizeText,
  normalizeTitle,
  normalizeTranscriptCache,
  titleParts,
  upsertTranscriptCache,
} from "@adr/crm-core";

const root = globalThis as typeof globalThis & {
  CRMWAUtils?: Readonly<Record<string, unknown>>;
};

root.CRMWAUtils = Object.freeze({
  chatKey,
  isRealName,
  isSameComposerText,
  normalizeComposerText,
  normalizeText,
  normalizeTitle,
  normalizeTranscriptCache,
  titleParts,
  upsertTranscriptCache,
});
