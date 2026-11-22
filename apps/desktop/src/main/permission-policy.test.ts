import { permissionGrantKey } from "./permission-policy.js";
import { describe, expect, it } from "vitest";

describe("permissionGrantKey", () => {
  it("é por origem e permissão, não por serviço", () => {
    expect(permissionGrantKey("https://web.whatsapp.com", "media")).toBe(
      "https://web.whatsapp.com|media",
    );
    expect(permissionGrantKey("https://web.whatsapp.com", "media")).not.toBe(
      permissionGrantKey("https://web.whatsapp.com", "camera"),
    );
  });

  it("recusa origem vazia — chamador trata como não lembrar", () => {
    expect(permissionGrantKey("", "media")).toBe("");
    expect(permissionGrantKey("https://web.whatsapp.com", "")).toBe("");
  });
});
import { allowPermissionCheck, decidePermission } from "./permission-policy.js";

describe("decidePermission", () => {
  it("asks media for youtube", () => {
    expect(decidePermission("media", "https://www.youtube.com/", "youtube")).toBe("ask");
  });

  it("denies media for gmail", () => {
    expect(decidePermission("media", "https://mail.google.com/", "gmail")).toBe("deny");
  });

  it("allows fullscreen for youtube", () => {
    expect(decidePermission("fullscreen", "https://www.youtube.com/", "youtube")).toBe("allow");
  });

  it("Drive é visualizador de mídia; Gmail e Calendar não", () => {
    expect(decidePermission("fullscreen", "https://drive.google.com/", "drive")).toBe("allow");
    expect(decidePermission("fullscreen", "https://calendar.google.com/", "calendar")).toBe("deny");
  });

  it("Notion pode pedir notificação; Drive e Calendar não", () => {
    expect(decidePermission("notifications", "https://www.notion.so/", "notion")).toBe("ask");
    expect(decidePermission("notifications", "https://drive.google.com/", "drive")).toBe("deny");
  });

  it("allows DRM without a prompt where media plays", () => {
    expect(decidePermission("mediaKeySystem", "https://open.spotify.com/", "spotify")).toBe("allow");
    expect(decidePermission("mediaKeySystem", "https://mail.google.com/", "gmail")).toBe("deny");
  });

  it("allows fullscreen and speaker routing where media plays", () => {
    expect(decidePermission("fullscreen", "https://web.whatsapp.com/", "whatsapp")).toBe("allow");
    expect(decidePermission("speaker-selection", "https://web.whatsapp.com/", "whatsapp")).toBe(
      "allow",
    );
    expect(decidePermission("speaker-selection", "https://mail.google.com/", "gmail")).toBe("deny");
  });

  // Negar storage-access tirava a credencial das chamadas de API do Spotify (403
  // em tudo); negar persistent-storage deixa o Chromium despejar a base local.
  it("allows the site's own storage permissions", () => {
    expect(decidePermission("storage-access", "https://open.spotify.com/", "spotify")).toBe("allow");
    expect(decidePermission("persistent-storage", "https://web.whatsapp.com/", "whatsapp")).toBe(
      "allow",
    );
    expect(decidePermission("storage-access", "https://x.com/", "shell")).toBe("deny");
  });

  // O "Copiar" do menu da mensagem do WhatsApp é navigator.clipboard.write():
  // com a permissão negada ele rejeita calado e o Ctrl+V da outra conversa cola
  // o nada. Escrever passa; ler (que vê o clipboard do resto do sistema) pergunta.
  it("lets the site write to the clipboard, and asks before letting it read", () => {
    expect(decidePermission("clipboard-sanitized-write", "https://web.whatsapp.com/", "whatsapp")).toBe(
      "allow",
    );
    expect(decidePermission("clipboard-write", "https://web.whatsapp.com/", "whatsapp")).toBe(
      "allow",
    );
    expect(decidePermission("clipboard-sanitized-write", "https://app.crm/", "crm")).toBe("allow");
    expect(decidePermission("clipboard-read", "https://web.whatsapp.com/", "whatsapp")).toBe("ask");
    expect(decidePermission("clipboard-sanitized-write", "file:///shell", "shell")).toBe("deny");
    expect(decidePermission("clipboard-read", "file:///shell", "panel")).toBe("deny");
  });

  it("denies unknown permissions", () => {
    expect(decidePermission("geolocation", "https://example.com/", "browser")).toBe("deny");
  });
});

describe("allowPermissionCheck", () => {
  // O check é consultado ANTES do getUserMedia. Devolver false com política
  // "ask" negava o microfone sem nunca chamar o request handler — e o WhatsApp
  // caía no próprio aviso "clique no ícone ao lado da barra de endereços", que
  // numa view sem barra de endereços não leva a lugar nenhum.
  it("lets an ask-policy permission through so the prompt can happen", () => {
    expect(decidePermission("media", "https://web.whatsapp.com/", "whatsapp")).toBe("ask");
    expect(allowPermissionCheck("media", "https://web.whatsapp.com/", "whatsapp")).toBe(true);
    expect(allowPermissionCheck("microphone", "https://web.whatsapp.com/", "whatsapp")).toBe(true);
  });

  it("still blocks what the policy denies", () => {
    expect(allowPermissionCheck("media", "https://mail.google.com/", "gmail")).toBe(false);
    expect(allowPermissionCheck("geolocation", "https://example.com/", "browser")).toBe(false);
    expect(allowPermissionCheck("storage-access", "https://x.com/", "shell")).toBe(false);
  });

  it("keeps allowing what the policy allows outright", () => {
    expect(allowPermissionCheck("fullscreen", "https://www.youtube.com/", "youtube")).toBe(true);
    // O check é consultado antes do write; false aqui já derruba o Copiar do
    // WhatsApp sem nunca chegar ao request handler.
    expect(
      allowPermissionCheck("clipboard-sanitized-write", "https://web.whatsapp.com/", "whatsapp"),
    ).toBe(true);
    expect(allowPermissionCheck("mediaKeySystem", "https://open.spotify.com/", "spotify")).toBe(
      true,
    );
  });
});
