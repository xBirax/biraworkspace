import { usesStandaloneLogin } from "@adr/service-adapters";

export type PermissionDecision = "allow" | "deny" | "ask";

/** Permissões que dão acesso a dispositivo — estas sempre passam pelo usuário. */
const MEDIA = new Set(["media", "microphone", "camera", "display-capture"]);

/** Kinds that legitimately play audio/video and may need output routing/fullscreen. */
const PLAYBACK_KINDS = new Set([
  "youtube",
  "spotify",
  "browser",
  "whatsapp",
  "instagram",
  "tiktok",
  "chatgpt",
  // Claude e Gemini: modo de voz pede microfone.
  "claude",
  "gemini",
  // Meet e Teams: câmera, microfone, tela cheia e escolha da saída de som.
  "meet",
  "teams",
  // O Drive é visualizador de mídia: preview de vídeo pede tela cheia e
  // roteamento de saída. Gmail e Calendar ficam de fora porque não tocam nada.
  "drive",
  // O CRM toca/grava áudio de mensagens; sem isto, passar a ter handler de
  // permissão (para poder silenciar) tiraria capacidade que ele já tinha.
  "crm",
]);

/** Decide default policy before prompting the user. */
export function decidePermission(
  permission: string,
  requestingUrl: string,
  serviceKind: string,
): PermissionDecision {
  // Escolher a saída de áudio (setSinkId / selectAudioOutput) não captura nada:
  // negar isso quebra o play de mídia em páginas que roteiam o som antes de tocar.
  // mediaKeySystem é DRM (EME): também não acessa dispositivo, e perguntar
  // "permitir mediaKeySystem?" no meio de um play é diálogo sem significado —
  // se cair em "negar", Spotify/YouTube simplesmente não tocam.
  if (permission === "speaker-selection" || permission === "mediaKeySystem") {
    return PLAYBACK_KINDS.has(serviceKind) ? "allow" : "deny";
  }
  if (permission === "notifications") {
    // Notion e Trello entram aqui: menções, comentários e lembretes são notificações
    // do produto. Sem isto o pedido cai no "deny" final — que resolve
    // a promise sem diálogo e sem erro, o mesmo silêncio do clipboard abaixo.
    return serviceKind === "whatsapp" ||
      serviceKind === "browser" ||
      serviceKind === "instagram" ||
      serviceKind === "outlook" ||
      serviceKind === "teams" ||
      usesStandaloneLogin(serviceKind)
      ? "ask"
      : "deny";
  }
  if (MEDIA.has(permission)) {
    if (PLAYBACK_KINDS.has(serviceKind)) {
      try {
        const host = new URL(requestingUrl).hostname;
        if (!host) return "deny";
        return "ask";
      } catch {
        return "deny";
      }
    }
    return "deny";
  }
  // WhatsApp/Instagram também abrem vídeo em tela cheia (anexos, stories).
  if (permission === "fullscreen") {
    return PLAYBACK_KINDS.has(serviceKind) ? "allow" : "deny";
  }
  // pointerLock captura o cursor: só onde faz sentido (player, jogo em página).
  // Chat e CRM não têm uso legítimo para isso.
  if (permission === "pointerLock") {
    return serviceKind === "youtube" || serviceKind === "browser" || serviceKind === "spotify"
      ? "allow"
      : "deny";
  }
  if (permission === "openExternal") return "ask";
  // Manter a tela acesa durante a reunião/vídeo (o Meet pede): não toca em
  // dispositivo nem dado, e negar só faz o monitor apagar no meio da chamada.
  if (permission === "screen-wake-lock") return PLAYBACK_KINDS.has(serviceKind) ? "allow" : "deny";
  /**
   * Área de transferência.
   *
   * O "Copiar" do menu da própria mensagem do WhatsApp não usa
   * `document.execCommand("copy")`: ele chama `navigator.clipboard.write()`, e o
   * Chromium consulta a permissão `clipboard-sanitized-write` antes de deixar.
   * Sem handler de permissão o Electron concedia; com o handler instalado (para
   * poder silenciar notificação) tudo que não estava listado aqui virava "deny",
   * e o clique em Copiar passou a não fazer NADA — a promessa rejeita dentro da
   * página, sem diálogo e sem erro visível, e o Ctrl+V na outra conversa cola o
   * que já estava no clipboard. É o "copiar não copia" que sobrou depois do menu
   * de contexto do app (aquele usa `copyImageAt`, que é do lado do main e nunca
   * passou por aqui).
   *
   * ESCREVER é o próprio site que o usuário abriu pondo no clipboard um conteúdo
   * que o Chromium sanitiza: "allow". LER é o oposto — entrega ao site tudo que
   * foi copiado de qualquer outro app —, então vai a "ask" e fica lembrado por
   * origem, como microfone e câmera.
   */
  if (permission === "clipboard-sanitized-write" || permission === "clipboard-write") {
    return serviceKind === "shell" || serviceKind === "panel" ? "deny" : "allow";
  }
  if (permission === "clipboard-read") {
    return serviceKind === "shell" || serviceKind === "panel" ? "deny" : "ask";
  }
  // Permissões de armazenamento do próprio site que o usuário escolheu abrir.
  // Nada de dispositivo, nada de dado de outro site:
  //  - storage-access: cookie do próprio domínio em contexto de terceira parte;
  //    negado, o Spotify perde a credencial nas chamadas de API e leva 403.
  //  - persistent-storage: evita o Chromium despejar a base local sob pressão
  //    de disco — no WhatsApp isso é a sessão inteira indo embora.
  if (
    permission === "storage-access" ||
    permission === "top-level-storage-access" ||
    permission === "persistent-storage"
  ) {
    return serviceKind === "shell" || serviceKind === "panel" ? "deny" : "allow";
  }
  return "deny";
}

/**
 * Resposta do `setPermissionCheckHandler` — que NÃO é a mesma do request handler.
 *
 * O check é síncrono e não abre diálogo, então a tentação é traduzir "ask" para
 * `false`. Para mídia isso mata o pedido: o Chromium consulta o check antes de
 * `getUserMedia` e, com `false`, nega na hora e **nunca** chama o request
 * handler — aquele que abriria o "Permitir microfone?" do app. O sintoma é o
 * WhatsApp exibindo o próprio aviso ("clique no ícone ao lado da barra de
 * endereços"), que numa view sem barra de endereços não leva a lugar nenhum.
 *
 * Aqui "ask" vira `true`: só significa "pode prosseguir e perguntar". Quem
 * decide continua sendo o request handler, com o diálogo na frente do usuário.
 * "deny" segue negando.
 */
export function allowPermissionCheck(
  permission: string,
  requestingUrl: string,
  serviceKind: string,
): boolean {
  return decidePermission(permission, requestingUrl, serviceKind) !== "deny";
}

/**
 * Chave da decisão lembrada: uma por (origem, permissão).
 *
 * Origem, não serviço: a permissão é do site. `web.whatsapp.com` autorizado num
 * WhatsApp vale nos outros — é o mesmo domínio pedindo a mesma coisa, e é o que
 * o Chromium faria se `setPermissionRequestHandler` não tivesse tomado o lugar
 * dele. Origem vazia devolve "", que o chamador trata como "não lembrar".
 */
export function permissionGrantKey(origin: string, permission: string): string {
  if (!origin || !permission) return "";
  return `${origin}|${permission}`;
}

/** Nome da permissão para a pessoa ("microfone", "notificações"...). */
export function permissionName(permission: string): string {
  const labels: Record<string, string> = {
    media: "microfone/câmera",
    "media:audio": "microfone",
    "media:video": "câmera",
    microphone: "microfone",
    camera: "câmera",
    notifications: "notificações",
    "display-capture": "compartilhar tela",
    openExternal: "abrir link externo",
    "clipboard-read": "ler a área de transferência",
  };
  return labels[permission] || permission;
}

export function permissionPromptLabel(permission: string, origin: string): string {
  const labels: Record<string, string> = {
    media: "microfone/câmera",
    microphone: "microfone",
    camera: "câmera",
    notifications: "notificações",
    "display-capture": "compartilhar tela",
    openExternal: "abrir link externo",
    "clipboard-read": "ler a área de transferência",
  };
  return `Permitir ${labels[permission] || permission} para ${origin}?`;
}

/**
 * Nome guardado de um "Permitir": `media` vira `media:audio` / `media:video`,
 * para que liberar o microfone de uma nota de voz não libere a câmera depois.
 */
export function grantNames(permission: string, mediaTypes?: readonly string[]): string[] {
  const types = (mediaTypes ?? []).filter((type) => type === "audio" || type === "video");
  return permission === "media" && types.length ? types.map((type) => `media:${type}`) : [permission];
}
