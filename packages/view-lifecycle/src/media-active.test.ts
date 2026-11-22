import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { MEDIA_ACTIVE_PROBE, shouldBlockHibernation } from "./media-active.js";

function probe(fields: Array<Record<string, unknown>>, options: { throwOnFields?: boolean } = {}) {
  const document = {
    querySelectorAll(selector: string) {
      if (selector === "audio,video") return [];
      if (options.throwOnFields) throw new Error("inaccessible form");
      return fields;
    },
  };
  return runInNewContext(MEDIA_ACTIVE_PROBE, { document, navigator: {}, window: {} }) as { active: boolean; reason?: string };
}

function field(properties: Record<string, unknown>) {
  return { closest: () => null, isContentEditable: false, ...properties };
}

describe("shouldBlockHibernation", () => {
  it("blocks on media or keepAwake", () => {
    expect(shouldBlockHibernation({ active: true, reason: "media" }, false)).toBe(true);
    expect(shouldBlockHibernation({ active: false }, true)).toBe(true);
    expect(shouldBlockHibernation({ active: false }, false)).toBe(false);
    expect(shouldBlockHibernation(undefined, false)).toBe(true);
  });
});

describe("MEDIA_ACTIVE_PROBE", () => {
  it("conteúdo existente pode hibernar; edição segue protegida depois de perder foco", () => {
    const editor = { isContentEditable: true, innerText: "Documento salvo", closest: (selector: string) => selector === "[contenteditable]" ? editor : null, contains: (node: unknown) => node === editor };
    const document = {
      activeElement: null as unknown,
      querySelectorAll: (selector: string) => selector === "audio,video" ? [] : [editor],
    };
    const context = { document, navigator: {}, window: {} as { __adrFormActivity?: { hasEdits: () => boolean } } };
    // Sem o rastreador não há prova de que o texto já estava salvo.
    expect(runInNewContext(MEDIA_ACTIVE_PROBE, context)).toEqual({ active: true, reason: "form" });
    let edited = false;
    context.window.__adrFormActivity = { hasEdits: () => edited && !!editor.innerText };
    expect(runInNewContext(MEDIA_ACTIVE_PROBE, context)).toEqual({ active: false });
    document.activeElement = editor;
    expect(runInNewContext(MEDIA_ACTIVE_PROBE, context)).toEqual({ active: true, reason: "form" });
    edited = true;
    document.activeElement = null;
    expect(runInNewContext(MEDIA_ACTIVE_PROBE, context)).toEqual({ active: true, reason: "form" });
    editor.innerText = "";
    expect(runInNewContext(MEDIA_ACTIVE_PROBE, context)).toEqual({ active: false });
  });

  it("protects an edited field even after focus moved elsewhere", () => {
    expect(probe([field({ tagName: "TEXTAREA", value: "draft", defaultValue: "" })])).toEqual({
      active: true,
      reason: "form",
    });
    expect(probe([field({ tagName: "INPUT", type: "checkbox", checked: true, defaultChecked: false })])).toEqual({
      active: true,
      reason: "form",
    });
  });

  it("fails closed when the form cannot be inspected", () => {
    expect(probe([], { throwOnFields: true })).toEqual({ active: true, reason: "probe-error" });
    expect(probe([])).toEqual({ active: false });
  });
});
