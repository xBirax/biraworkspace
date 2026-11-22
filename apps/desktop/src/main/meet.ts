/**
 * Google Meet: o que o app precisa saber sem tocar no Electron.
 *
 * O Meet roda na sessão Google do workspace (as contas do Gmail), e o resto do
 * app trata uma REUNIÃO em andamento como coisa que não se interrompe: a aba não
 * hiberna nem é estrangulada em segundo plano, e a atualização espera.
 *
 * A URL da sala (`xxx-xxxx-xxx`) não basta: a tela "Pronto para participar?" e a
 * de "você saiu da reunião" ficam no mesmo endereço. Estar NA chamada é a sala +
 * o botão de sair da chamada na página (MEET_IN_CALL_PROBE).
 */

const MEET_ORIGIN = "https://meet.google.com";
const MEETING_CODE = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:\/|$)/i;

/** Qualquer página do Meet (sala, tela inicial, link de convite). */
export function isMeetUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === MEET_ORIGIN && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

/** Endereço de uma sala — a pessoa pode estar dentro, na entrada ou já ter saído. */
export function isMeetCallUrl(url: string): boolean {
  try {
    return isMeetUrl(url) && MEETING_CODE.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** Código da sala (`abc-defg-hij`), ou "" fora de uma sala. */
export function meetRoom(url: string): string {
  try {
    return isMeetCallUrl(url) ? (new URL(url).pathname.split("/")[1] ?? "").toLowerCase() : "";
  } catch {
    return "";
  }
}

/**
 * Sonda executada na aba do Meet: há botão de sair da chamada? Só existe com a
 * pessoa dentro da reunião. Por rótulo acessível, em português e inglês — o
 * `jsname` interno do Meet muda sem aviso.
 */
export const MEET_IN_CALL_PROBE = `(() => {
  const leave = /sair da chamada|deixar a chamada|encerrar a chamada|leave call|end call/i;
  return [...document.querySelectorAll('button[aria-label], [role="button"][aria-label]')]
    .some((node) => leave.test(node.getAttribute("aria-label") || ""));
})()`;

/** Teams: o botão "Sair" (#hangup-button) só existe com a pessoa dentro da sala. */
export const TEAMS_IN_CALL_PROBE = `!!document.getElementById("hangup-button")`;

/**
 * A aba do Teams está numa chamada? Sala muda e de câmera desligada não toca
 * nada que a sonda de mídia veja. Sonda sem resposta (ou que falhou) conta
 * como "sim": adiar a hibernação é melhor que derrubar alguém da reunião.
 */
export async function teamsInCall(
  contents: { executeJavaScript(code: string): Promise<unknown> },
  timeoutMs = 3000,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return Boolean(
      await Promise.race([
        contents.executeJavaScript(TEAMS_IN_CALL_PROBE),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(true), timeoutMs);
        }),
      ]),
    );
  } catch {
    return true;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Liga/desliga o microfone da chamada (atalho global Ctrl+Alt+M). Clica no botão
 * de microfone da barra do Meet, achado pelo rótulo acessível — o atalho do
 * próprio Meet (Ctrl+D) só funciona com a aba em foco, e o atalho global existe
 * justamente para quando o app está em segundo plano. Devolve o estado NOVO
 * ("muted" | "unmuted"), ou "" se o botão não foi encontrado.
 */
export const MEET_TOGGLE_MIC = `(() => {
  const toMute = /desativar (o )?microfone|turn off microphone/i;
  const toUnmute = /ativar (o )?microfone|turn on microphone/i;
  const buttons = [...document.querySelectorAll('button[aria-label], [role="button"][aria-label]')];
  const label = (node) => node.getAttribute("aria-label") || "";
  // O botão da barra de controles traz o atalho no rótulo ("... (ctrl + d)").
  // Preferi-lo evita o "desativar microfone" de OUTRO participante no painel
  // de pessoas, que o organizador vê e que viria antes na ordem da página.
  const own = (node) => /ctrl\\s*\\+\\s*d/i.test(label(node));
  const pick = (test) => buttons.find((node) => test(label(node)) && own(node)) || buttons.find((node) => test(label(node)));
  const mute = pick((text) => toMute.test(text));
  if (mute) { mute.click(); return "muted"; }
  const unmute = pick((text) => toUnmute.test(text) && !toMute.test(text));
  if (unmute) { unmute.click(); return "unmuted"; }
  return "";
})()`;

export type ScreenShareSource = { id: string; name: string };
export type ScreenShareChoice = { label: string; sourceId: string };

/**
 * Opções do seletor de "Apresentar agora". O Electron não tem seletor nativo no
 * Windows: sem um, `getDisplayMedia` falha e o Meet diz que não dá para
 * compartilhar. Telas primeiro (o caso comum), depois janelas.
 *
 * Sem "som do computador": o loopback do Windows captura TODO o áudio do
 * sistema, inclusive as vozes da própria reunião, que voltariam como eco para
 * quem está falando.
 */
export function screenShareChoices(sources: readonly ScreenShareSource[]): ScreenShareChoice[] {
  const screens = sources.filter((source) => source.id.startsWith("screen:"));
  const windows = sources.filter((source) => source.id.startsWith("window:") && source.name.trim());
  const choices: ScreenShareChoice[] = screens.map((screen, index) => ({
    label:
      screens.length === 1
        ? "Tela inteira"
        : `Tela ${index + 1}${screen.name ? ` — ${screen.name}` : ""}`,
    sourceId: screen.id,
  }));
  for (const window of windows) {
    const name = window.name.trim();
    choices.push({
      label: `Janela: ${name.length > 60 ? `${name.slice(0, 57)}…` : name}`,
      sourceId: window.id,
    });
  }
  return choices;
}
