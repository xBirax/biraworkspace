import { desktopCapturer, webContents, type BaseWindow, type WebContents } from "electron";
import { decidePermission } from "./permission-policy.js";
import { screenShareChoices, type ScreenShareChoice } from "./meet.js";
import { popupChoice } from "./popup-choice.js";

/**
 * "Apresentar agora" do Meet (e getDisplayMedia de qualquer serviço de mídia).
 *
 * Sem `setDisplayMediaRequestHandler` o Electron recusa todo compartilhamento de
 * tela, e no Windows não existe seletor nativo: o seletor é um menu com as telas
 * e as janelas abertas. Só a aba da frente, com a janela em foco, e só serviço
 * que já pode usar câmera/microfone. Fechar o menu sem escolher recusa.
 *
 * Saiu de workspace-window.ts: depende só do que recebe em `deps`.
 */
export type ScreenShareDeps = {
  parentWindow: BaseWindow;
  viewMeta: WeakMap<WebContents, { kind: string }>;
  isFrontView: (contents: WebContents) => boolean;
  log: (level: "info" | "error", message: string, extra?: unknown) => void;
};

export function createScreenShare(deps: ScreenShareDeps): (ses: Electron.Session) => void {
  const attached = new WeakSet<Electron.Session>();
  return (ses) => {
    if (attached.has(ses)) return;
    attached.add(ses);
    ses.setDisplayMediaRequestHandler((request, callback) => {
      let answered = false;
      /** `null` recusa. `{}` com vídeo pedido LANÇA no Electron 44 ("Video was
       *  requested, but no video stream was provided") — e cancelar o seletor
       *  virava o diálogo de erro do processo principal. */
      const answer = (streams: Electron.Streams | null): void => {
        if (answered) return;
        answered = true;
        try {
          callback(streams as Electron.Streams);
        } catch (error) {
          deps.log("error", "compartilhar tela", { erro: String(error) });
        }
      };
      const contents = request.frame ? webContents.fromFrame(request.frame) : undefined;
      const meta = contents ? deps.viewMeta.get(contents) : undefined;
      if (
        !contents ||
        !meta ||
        // Só a página da aba pede a tela: um iframe de outro site dentro dela
        // (anúncio, widget) não ganha o seletor com cara de pedido do serviço.
        request.frame?.parent != null ||
        decidePermission("display-capture", request.securityOrigin, meta.kind) === "deny" ||
        !deps.isFrontView(contents) ||
        !deps.parentWindow.isFocused()
      ) {
        deps.log("info", "compartilhar tela negado", { kind: meta?.kind ?? "desconhecido" });
        answer(null);
        return;
      }
      void desktopCapturer
        .getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          const choices = screenShareChoices(sources);
          if (!choices.length) {
            answer(null);
            return;
          }
          const choose = (choice?: ScreenShareChoice): void => {
            const source = choice && sources.find((item) => item.id === choice.sourceId);
            if (!choice || !source) {
              answer(null);
              return;
            }
            deps.log("info", "compartilhar tela", { kind: meta.kind, tipo: source.id.split(":")[0] });
            answer({ video: source });
          };
          let site = request.securityOrigin;
          try {
            site = new URL(request.securityOrigin).host || site;
          } catch {
            /* origem opaca: mostra como veio */
          }
          // Fechar o menu sem escolher (ou "Cancelar") recusa.
          return popupChoice<ScreenShareChoice>(deps.parentWindow, [
            // O site que pede vai no topo: no ADR Browser pode ser qualquer um.
            { header: `${site} quer ver a sua tela. Compartilhar:` },
            { separator: true },
            ...choices.map((choice) => ({ label: choice.label, value: choice })),
            { separator: true },
            { label: "Cancelar", cancel: true },
          ]).then(choose);
        })
        .catch(() => answer(null));
    });
  };
}
