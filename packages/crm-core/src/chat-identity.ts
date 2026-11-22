import { chatIdentitySchema, type ChatIdentity } from "@adr/contracts";

function serialized(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object" && value && "_serialized" in value) {
    return String((value as { _serialized?: unknown })._serialized || "");
  }
  return String(value);
}

/**
 * Título da conversa só serve como nome quando é mesmo um nome: contato que não
 * está salvo aparece com o próprio número no lugar do título, e salvar isso na
 * agenda criaria um contato chamado "+55 11 99999-8888".
 */
export function chatDisplayName(title: unknown): string | null {
  const raw = String(title ?? "").trim();
  if (!raw) return null;
  // Sobrou algo depois de tirar dígitos e pontuação de telefone? Então é nome.
  return raw.replace(/[\d\s+()\-.]/g, "") ? raw : null;
}

/**
 * Primeiro candidato que É um nome — não o primeiro que existe. Contato fora da
 * agenda tem `formattedTitle` igual ao próprio telefone: com `||` ele vencia a
 * disputa e só então era recusado, e o nome público do perfil (`pushname`), que
 * vem depois na fila, nunca chegava a ser consultado.
 */
export function firstChatDisplayName(candidates: readonly unknown[]): string | null {
  for (const candidate of candidates) {
    const name = chatDisplayName(candidate);
    if (name) return name;
  }
  return null;
}

/** Pure port of the extension 0.12.5 fiber chat probe (given a chat object). */
export function identityFromWhatsAppChat(chat: {
  id?: unknown;
  contact?: { phoneNumber?: unknown; name?: unknown; pushname?: unknown };
  formattedTitle?: unknown;
  name?: unknown;
} | null | undefined): ChatIdentity | null {
  if (!chat) return null;
  const id = serialized(chat.id);
  const candidate = serialized(chat.contact?.phoneNumber) || id;
  const digits = /@c\.us$/i.test(candidate)
    ? candidate.replace(/@.*/, "").replace(/\D/g, "")
    : "";
  return chatIdentitySchema.parse({
    id: id || null,
    phone: digits.length >= 8 && digits.length <= 15 ? digits : null,
    isGroup: /@g\.us$/i.test(id),
    name: firstChatDisplayName([
      chat.formattedTitle,
      chat.name,
      chat.contact?.name,
      chat.contact?.pushname,
    ]),
  });
}

export function wrapChatIdentityResult(raw: unknown): { chat: ChatIdentity | null } {
  if (raw == null) return { chat: null };
  const parsed = chatIdentitySchema.safeParse(raw);
  if (!parsed.success) return { chat: null };
  return { chat: parsed.data };
}

/** Injected into WhatsApp MAIN world — keep in sync with identityFromWhatsAppChat. */
export const CHAT_IDENTITY_PROBE = `(() => {
  const header = document.querySelector("#main header");
  if (!header) return null;
  const fiberOf = (element) => {
    for (const key in element) {
      if (key.startsWith("__reactFiber$") || key.startsWith("__reactProps$")) return element[key];
    }
    return null;
  };
  const serialized = (value) => {
    if (value == null) return "";
    if (typeof value === "object") return value._serialized || "";
    return String(value);
  };
  let fiber = fiberOf(header);
  for (let hops = 0; fiber && hops < 60; hops += 1, fiber = fiber.return) {
    const props = fiber.memoizedProps || fiber.pendingProps || {};
    const chat = props.chat;
    if (!chat) continue;
    const id = serialized(chat.id);
    const candidate = serialized(chat.contact?.phoneNumber) || id;
    const digits = /@c\\.us$/i.test(candidate) ? candidate.replace(/@.*/, "").replace(/\\D/g, "") : "";
    // Mantido em sincronia com firstChatDisplayName: título que só tem número não
    // é nome, e a fila continua até achar um que seja (senão o telefone do
    // formattedTitle ganharia e o pushname nunca seria lido).
    const displayName = (value) => {
      const raw = String(value ?? "").trim();
      if (!raw) return null;
      return raw.replace(/[\\d\\s+()\\-.]/g, "") ? raw : null;
    };
    const name =
      [chat.formattedTitle, chat.name, chat.contact?.name, chat.contact?.pushname]
        .map(displayName)
        .find(Boolean) || null;
    return {
      id: id || null,
      phone: digits.length >= 8 && digits.length <= 15 ? digits : null,
      isGroup: /@g\\.us$/i.test(id),
      name,
    };
  }
  return null;
})()`;
