import { describe, expect, it } from "vitest";
import { parseAppState } from "@adr/app-state";
import { serviceKindSchema } from "@adr/contracts";
import {
  SERVICE_CATALOG,
  addServiceToWorkspace,
  bootstrapAppState,
  duplicateServiceInWorkspace,
  ensureDefaultWorkspaceState,
} from "./service-catalog.js";

describe("service catalog", () => {
  it("novos WhatsApp/Gmail ficam em memória; Outlook/Teams podem hibernar", () => {
    let state = bootstrapAppState();
    for (const kind of ["gmail", "outlook", "teams"] as const) state = addServiceToWorkspace(state, kind);
    for (const service of state.services) {
      expect(service.keepAwake).toBe(service.kind === "whatsapp" || service.kind === "gmail");
    }
    const existing = parseAppState({
      ...state,
      services: state.services.map((service) => ({ ...service, keepAwake: !service.keepAwake })),
    });
    expect(ensureDefaultWorkspaceState(existing).services).toEqual(existing.services);
    state = addServiceToWorkspace(state, "outlook", undefined, { newGoogleAccount: true });
    expect(state.services.at(-1)!.keepAwake).toBe(false);
  });

  it("bootstraps a default WhatsApp and exposes media services", () => {
    const state = bootstrapAppState();
    expect(state.services.some((s) => s.kind === "whatsapp")).toBe(true);
    expect(SERVICE_CATALOG.every((c) => c.available)).toBe(true);
  });

  // Kind novo esquecido aqui passa build, typecheck e a suíte inteira: some da
  // grade "adicionar serviço" e `addServiceToWorkspace` responde "ainda não
  // disponível". O preset já é cobrado por `getPreset`, que lança; o catálogo não era.
  it("todo ServiceKind aparece no catálogo", () => {
    const listed = new Set(SERVICE_CATALOG.map((c) => c.kind));
    expect(serviceKindSchema.options.filter((kind) => !listed.has(kind))).toEqual([]);
  });

  it("Claude tem sessão própria e duplicar abre outra conta", () => {
    let state = addServiceToWorkspace(bootstrapAppState(), "claude");
    const claude = state.services.find((s) => s.kind === "claude")!;
    state = duplicateServiceInWorkspace(state, claude.id).state;
    const claudes = state.services.filter((s) => s.kind === "claude");
    expect(claudes).toHaveLength(2);
    expect(claudes[1]!.name).toBe("Claude (outra conta)");
    const partitions = claudes.map(
      (s) => state.profiles.find((p) => p.id === s.profileId)!.partitionName,
    );
    expect(new Set(partitions).size).toBe(2);
  });

  it("Gemini usa a sessão Google do workspace, um por workspace", () => {
    let state = addServiceToWorkspace(bootstrapAppState(), "gmail");
    state = addServiceToWorkspace(state, "gemini");
    const gmail = state.services.find((s) => s.kind === "gmail")!;
    expect(state.services.find((s) => s.kind === "gemini")!.profileId).toBe(gmail.profileId);
    expect(() => addServiceToWorkspace(state, "gemini")).toThrow(/já adicionado/);
  });

  it("Notion duplicado abre outra conta, como os demais de login próprio", () => {
    let state = addServiceToWorkspace(bootstrapAppState(), "notion");
    const notion = state.services.find((s) => s.kind === "notion")!;
    state = duplicateServiceInWorkspace(state, notion.id).state;
    const [first, second] = state.services.filter((s) => s.kind === "notion");
    expect(second!.profileId).not.toBe(first!.profileId);
  });

  it("adds WhatsApp, Google, YouTube, Spotify and browser services", () => {
    let state = bootstrapAppState();
    state = addServiceToWorkspace(state, "whatsapp", "Trabalho");
    expect(state.services.filter((s) => s.kind === "whatsapp")).toHaveLength(2);
    state = addServiceToWorkspace(state, "gmail");
    expect(state.services.some((s) => s.kind === "gmail")).toBe(true);
    expect(state.services.some((s) => s.kind === "calendar")).toBe(true);
    const googleProfileId = state.services.find((s) => s.kind === "gmail")!.profileId;
    state = addServiceToWorkspace(state, "youtube");
    expect(state.services.some((s) => s.kind === "youtube")).toBe(true);
    expect(state.services.find((s) => s.kind === "youtube")!.profileId).toBe(googleProfileId);
    state = addServiceToWorkspace(state, "browser");
    expect(state.services.some((s) => s.kind === "browser")).toBe(true);
    expect(state.services.find((s) => s.kind === "browser")!.profileId).toBe(googleProfileId);
    state = addServiceToWorkspace(state, "spotify");
    expect(state.services.some((s) => s.kind === "spotify")).toBe(true);
    expect(state.services.find((s) => s.kind === "spotify")!.profileId).toBe(googleProfileId);
  });

  it("Drive entra na sessão Google do workspace; Notion tem a sua", () => {
    let state = bootstrapAppState();
    state = addServiceToWorkspace(state, "gmail");
    const googleProfileId = state.services.find((s) => s.kind === "gmail")!.profileId;
    state = addServiceToWorkspace(state, "drive");
    expect(state.services.find((s) => s.kind === "drive")!.profileId).toBe(googleProfileId);

    state = addServiceToWorkspace(state, "notion");
    const notion = state.services.find((s) => s.kind === "notion")!;
    expect(notion.profileId).not.toBe(googleProfileId);
    const profile = state.profiles.find((p) => p.id === notion.profileId)!;
    expect(profile.partitionName).toMatch(/^persist:browser-/);

    // Segunda conta: partição própria, senão a primeira seria derrubada.
    state = addServiceToWorkspace(state, "notion");
    const notions = state.services.filter((s) => s.kind === "notion");
    expect(notions).toHaveLength(2);
    expect(notions[1]!.profileId).not.toBe(notions[0]!.profileId);
    expect(notions[1]!.name).toBe("Notion 2");
  });

  it("duplicates browser views with the same authenticated profile", () => {
    let state = bootstrapAppState();
    state = addServiceToWorkspace(state, "browser", "Pesquisa");
    const source = state.services.find((service) => service.kind === "browser")!;
    const duplicated = duplicateServiceInWorkspace(state, source.id);
    const copy = duplicated.state.services.find(
      (service) => service.id === duplicated.duplicatedId,
    )!;

    expect(copy.profileId).toBe(source.profileId);
    expect(copy.name).toBe("Pesquisa (cópia)");
  });

  it("adds a second Google account instead of refusing the duplicate kind", () => {
    let state = bootstrapAppState();
    state = addServiceToWorkspace(state, "gmail");
    const first = state.services.find((s) => s.kind === "gmail")!;

    // Sem a flag continua sendo um serviço por workspace.
    expect(() => addServiceToWorkspace(state, "gmail")).toThrow();

    state = addServiceToWorkspace(state, "gmail", undefined, { newGoogleAccount: true });
    const gmails = state.services.filter((s) => s.kind === "gmail");
    expect(gmails).toHaveLength(2);
    expect(gmails[1]!.profileId).not.toBe(first.profileId);
    expect(gmails[1]!.name).toBe("Gmail 2");

    const partitions = gmails.map(
      (s) => state.profiles.find((p) => p.id === s.profileId)!.partitionName,
    );
    expect(new Set(partitions).size).toBe(2);
  });

  it("duplicates a Google service into a brand new account", () => {
    let state = bootstrapAppState();
    state = addServiceToWorkspace(state, "youtube", "YouTube");
    const source = state.services.find((s) => s.kind === "youtube")!;
    const duplicated = duplicateServiceInWorkspace(state, source.id, { newGoogleAccount: true });
    const copy = duplicated.state.services.find((s) => s.id === duplicated.duplicatedId)!;

    expect(copy.profileId).not.toBe(source.profileId);
    expect(duplicated.state.profiles.find((p) => p.id === copy.profileId)!.partitionName).toMatch(
      /^persist:google-/,
    );
  });

  it("duplicates WhatsApp with an isolated persistent profile", () => {
    const state = bootstrapAppState();
    const source = state.services.find((service) => service.kind === "whatsapp")!;
    const duplicated = duplicateServiceInWorkspace(state, source.id);
    const copy = duplicated.state.services.find(
      (service) => service.id === duplicated.duplicatedId,
    )!;
    const sourceProfile = state.profiles.find((profile) => profile.id === source.profileId)!;
    const copyProfile = duplicated.state.profiles.find((profile) => profile.id === copy.profileId)!;

    expect(copy.profileId).not.toBe(source.profileId);
    expect(sourceProfile.partitionName).toMatch(/^persist:/);
    expect(copyProfile.partitionName).toMatch(/^persist:/);
  });
});

describe("manter sempre ativo (mídia)", () => {
  it("YouTube nasce protegido, inclusive na segunda conta Google", () => {
    let state = bootstrapAppState();
    state = addServiceToWorkspace(state, "youtube");
    const source = state.services.find((s) => s.kind === "youtube")!;
    expect(source.keepAwake).toBe(true);

    // Este caminho não aplicava o default: a aba da outra conta era hibernada no
    // meio do vídeo por ociosidade ou por pressão de RAM.
    const duplicated = duplicateServiceInWorkspace(state, source.id, { newGoogleAccount: true });
    const copy = duplicated.state.services.find((s) => s.id === duplicated.duplicatedId)!;
    expect(copy.keepAwake).toBe(true);
  });

  it("migra serviço antigo uma vez e não desfaz o que o usuário desligou", () => {
    const fresh = addServiceToWorkspace(bootstrapAppState(), "youtube");
    // Estado anterior ao default: sem registro de migração e sem proteção.
    const legacy = parseAppState({
      ...fresh,
      migrations: [],
      services: fresh.services.map((s) => ({ ...s, keepAwake: false })),
    });

    const migrated = ensureDefaultWorkspaceState(legacy);
    expect(migrated.services.find((s) => s.kind === "youtube")!.keepAwake).toBe(true);

    const turnedOff = parseAppState({
      ...migrated,
      services: migrated.services.map((s) =>
        s.kind === "youtube" ? { ...s, keepAwake: false } : s,
      ),
    });
    expect(
      ensureDefaultWorkspaceState(turnedOff).services.find((s) => s.kind === "youtube")!.keepAwake,
    ).toBe(false);
  });

  it("chave global dos mensageiros vira escolha por serviço, uma vez", () => {
    const fresh = addServiceToWorkspace(bootstrapAppState(), "outlook");
    const legacy = (keepMessengersAwake: boolean) =>
      parseAppState({
        ...fresh,
        migrations: [],
        settings: { ...fresh.settings, keepMessengersAwake },
        services: fresh.services.map((s) => ({ ...s, keepAwake: false })),
      });
    const kept = ensureDefaultWorkspaceState(legacy(true));
    expect(kept.services.filter((s) => s.kind === "outlook" || s.kind === "whatsapp").every((s) => s.keepAwake)).toBe(true);
    // Quem tinha a chave desligada continua podendo hibernar todos.
    expect(ensureDefaultWorkspaceState(legacy(false)).services.some((s) => s.keepAwake)).toBe(false);
    // Desligar depois, no serviço, não é desfeito no próximo boot.
    const turnedOff = parseAppState({
      ...kept,
      services: kept.services.map((s) => (s.kind === "outlook" ? { ...s, keepAwake: false } : s)),
    });
    expect(ensureDefaultWorkspaceState(turnedOff).services.find((s) => s.kind === "outlook")!.keepAwake).toBe(false);
  });

  it.each(["auto", "brave", "chrome"] as const)(
    "preserva a escolha salva de navegador: %s",
    (preference) => {
      const fresh = bootstrapAppState();
      const legacy = parseAppState({
        ...fresh,
        migrations: [],
        settings: { ...fresh.settings, preferredExternalBrowser: preference },
      });

      const migrated = ensureDefaultWorkspaceState(legacy);
      expect(migrated.settings.preferredExternalBrowser).toBe(preference);

      const explicitBrave = parseAppState({
        ...migrated,
        settings: { ...migrated.settings, preferredExternalBrowser: "brave" },
      });
      expect(ensureDefaultWorkspaceState(explicitBrave).settings.preferredExternalBrowser).toBe(
        "brave",
      );
    },
  );
});

describe("Outlook e Teams no catálogo", () => {
  it("dividem a conta Microsoft; outra conta e duplicar criam conta nova", () => {
    let state = bootstrapAppState();
    state = addServiceToWorkspace(state, "outlook");
    state = addServiceToWorkspace(state, "teams");
    const [outlook, teams] = ["outlook", "teams"].map((kind) => state.services.find((s) => s.kind === kind)!);
    expect(outlook!.name).toBe("Outlook");
    expect(teams!.profileId).toBe(outlook!.profileId);
    expect(state.profiles.find((p) => p.id === outlook!.profileId)!.partitionName).toMatch(/^persist:ms-/);

    expect(() => addServiceToWorkspace(state, "outlook")).toThrow(/já adicionado/);
    state = addServiceToWorkspace(state, "outlook", undefined, { newGoogleAccount: true });
    const second = state.services.filter((s) => s.kind === "outlook")[1]!;
    expect(second.name).toBe("Outlook 2");
    expect(second.profileId).not.toBe(outlook!.profileId);

    const sameAccount = duplicateServiceInWorkspace(state, teams!.id);
    expect(sameAccount.state.services.find((s) => s.id === sameAccount.duplicatedId)!.profileId).toBe(
      teams!.profileId,
    );
    const otherAccount = duplicateServiceInWorkspace(state, teams!.id, { newGoogleAccount: true });
    expect(otherAccount.state.services.find((s) => s.id === otherAccount.duplicatedId)!.profileId).not.toBe(
      teams!.profileId,
    );
  });
});
