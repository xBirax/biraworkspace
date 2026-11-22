/** Script injected to detect active media / unsaved form before hibernation. */
export const MEDIA_ACTIVE_PROBE = `(() => {
  try {
    const media = [...document.querySelectorAll("audio,video")].some((el) => {
      const m = el;
      return m && !m.paused && !m.ended && m.readyState > 2;
    });
    if (media) return { active: true, reason: "media" };
    if (navigator.mediaSession && navigator.mediaSession.playbackState === "playing") {
      return { active: true, reason: "mediasession" };
    }
    const fields = document.querySelectorAll("input,textarea,select,[contenteditable]");
    const tracker = window.__adrFormActivity;
    const tracked = typeof tracker?.hasEdits === "function";
    // A very large or inaccessible form is an unknown state, not permission to close it.
    if (fields.length > 1000) return { active: true, reason: "form-unknown" };
    if (tracked && tracker.hasEdits()) return { active: true, reason: "form" };
    for (const field of fields) {
      if (field.closest("[hidden],[aria-hidden='true']")) continue;
      if (field.isContentEditable) {
        // Sem rastreador, o estado é desconhecido. Perder foco não apaga uma edição.
        const edited = !tracked;
        if ((edited || field.contains(document.activeElement)) && String(field.innerText || field.textContent || "").trim()) {
          return { active: true, reason: "form" };
        }
        continue;
      }
      if (field.tagName === "INPUT") {
        const type = String(field.type || "").toLowerCase();
        if (type === "hidden" || type === "submit" || type === "button" || type === "reset") continue;
        if (type === "checkbox" || type === "radio") {
          if (field.checked !== field.defaultChecked) return { active: true, reason: "form" };
        } else if (field.value !== field.defaultValue) {
          return { active: true, reason: "form" };
        }
      } else if (field.tagName === "TEXTAREA") {
        if (field.value !== field.defaultValue) return { active: true, reason: "form" };
      } else if (field.tagName === "SELECT") {
        if ([...field.options].some((option) => option.selected !== option.defaultSelected)) {
          return { active: true, reason: "form" };
        }
      }
    }
    return { active: false };
  } catch (e) {
    return { active: true, reason: "probe-error" };
  }
})()`;

export type MediaProbeResult = { active: boolean; reason?: string };

export function shouldBlockHibernation(probe: MediaProbeResult | null | undefined, keepAwake: boolean): boolean {
  return keepAwake || probe?.active !== false;
}
