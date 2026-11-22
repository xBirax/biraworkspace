import { describe, expect, it } from "vitest";
import {
  CHAT_IDENTITY_PROBE,
  chatDisplayName,
  identityFromWhatsAppChat,
  wrapChatIdentityResult,
} from "../src/chat-identity.js";

describe("chat identity probe", () => {
  it("identifies individual contacts", () => {
    expect(
      identityFromWhatsAppChat({
        id: "5511999998888@c.us",
        contact: { phoneNumber: "5511999998888@c.us" },
      }),
    ).toEqual({
      id: "5511999998888@c.us",
      phone: "5511999998888",
      isGroup: false,
      name: null,
    });
  });

  it("leva o nome quando o contato está salvo, e só o telefone quando não está", () => {
    const salvo = identityFromWhatsAppChat({
      id: "5511999998888@c.us",
      contact: { phoneNumber: "5511999998888@c.us" },
      formattedTitle: "Ana Mosconi",
    });
    expect(salvo?.name).toBe("Ana Mosconi");
    const naoSalvo = identityFromWhatsAppChat({
      id: "5511999998888@c.us",
      contact: { phoneNumber: "5511999998888@c.us" },
      formattedTitle: "+55 11 99999-8888",
    });
    expect(naoSalvo?.name).toBeNull();
  });

  it("usa o nome público do perfil quando o título é só o telefone", () => {
    // Contato fora da agenda: o cabeçalho mostra o número, mas o perfil tem nome
    // público. É esse que vai para o Google Contacts.
    const identity = identityFromWhatsAppChat({
      id: "5511982376057@c.us",
      contact: { phoneNumber: "5511982376057@c.us", pushname: "Edi" },
      formattedTitle: "+55 11 98237-6057",
    });
    expect(identity?.name).toBe("Edi");
    // Nome da agenda continua ganhando do nome público.
    const salvo = identityFromWhatsAppChat({
      id: "5511982376057@c.us",
      contact: { phoneNumber: "5511982376057@c.us", name: "Edi", pushname: "edizinha 💅" },
      formattedTitle: "Edilene | Paper Station",
    });
    expect(salvo?.name).toBe("Edilene | Paper Station");
    // Sem nenhum candidato que seja nome, continua null (não devolve o telefone).
    const semNome = identityFromWhatsAppChat({
      id: "5511982376057@c.us",
      contact: { phoneNumber: "5511982376057@c.us" },
      formattedTitle: "+55 11 98237-6057",
    });
    expect(semNome?.name).toBeNull();
  });

  it("chatDisplayName recusa título que é só número", () => {
    expect(chatDisplayName("Ana Mosconi")).toBe("Ana Mosconi");
    expect(chatDisplayName("~ João")).toBe("~ João");
    expect(chatDisplayName("+55 (11) 99999-8888")).toBeNull();
    expect(chatDisplayName("")).toBeNull();
    expect(chatDisplayName(null)).toBeNull();
  });

  it("identifies groups without inventing a phone", () => {
    expect(
      identityFromWhatsAppChat({
        id: "12036301@g.us",
      }),
    ).toEqual({
      id: "12036301@g.us",
      phone: null,
      isGroup: true,
      name: null,
    });
  });

  it("returns controlled null for missing/invalid probe results", () => {
    expect(identityFromWhatsAppChat(null)).toBeNull();
    expect(wrapChatIdentityResult(null)).toEqual({ chat: null });
    expect(wrapChatIdentityResult({ id: 1 })).toEqual({ chat: null });
    expect(CHAT_IDENTITY_PROBE).toContain("#main header");
  });

  it("a sonda injetada percorre os mesmos candidatos de nome", () => {
    // As duas cópias só se mantêm juntas por revisão: a sonda é string injetada
    // em outro processo e não dá para exercitá-la aqui. Isto pega a regressão
    // exata que já aconteceu — arrumar a função pura e esquecer a sonda.
    expect(CHAT_IDENTITY_PROBE).toContain("chat.contact?.pushname");
    expect(CHAT_IDENTITY_PROBE).toContain(".find(Boolean)");
  });
});
