import { DEFAULT_BASE_URL } from "@adr/crm-core";

/** Placeholder shell entry until Electron wiring (refinements 13–15). */
export function getDesktopBootstrapInfo(): { product: string; defaultCrmBaseUrl: string } {
  return {
    product: "BiraWorkspace",
    defaultCrmBaseUrl: DEFAULT_BASE_URL,
  };
}
