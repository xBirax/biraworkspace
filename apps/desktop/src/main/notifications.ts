import type { NotificationSettings } from "@adr/contracts";

/**
 * Não perturbe: silencia entre `from` e `to`. A janela quase sempre cruza a
 * meia-noite (19h→8h), então o caso "from > to" é o normal, não a exceção.
 * from === to significa janela vazia (nunca silencia) — 24h de silêncio se
 * escreve desligando as notificações, não aqui.
 */
export function isQuietHour(hour: number, from = 19, to = 8): boolean {
  if (from === to) return false;
  return from > to ? hour >= from || hour < to : hour >= from && hour < to;
}

/**
 * Regras do guard de notificações da PÁGINA, escritas uma vez e injetadas com
 * .toString() (como isQuietHour): valem para `new Notification` e para
 * `registration.showNotification`. Usam só o que o script injetado define
 * (isQuietHour) — sem import, sem closure.
 */
export type PageNotificationSettings = {
  enabled?: boolean;
  meetingQuiet?: boolean;
  quietHours?: boolean;
  quietFromHour?: number;
  quietToHour?: number;
  hidePreview?: boolean;
};

/** Desligado pelo usuário, não perturbe por horário, ou reunião do Meet em curso. */
export function notificationSilenced(settings: PageNotificationSettings, hour: number): boolean {
  if (settings.enabled === false || settings.meetingQuiet === true) return true;
  return Boolean(settings.quietHours && isQuietHour(hour, settings.quietFromHour, settings.quietToHour));
}

/** PIN ativo: quem mandou aparece; o texto e a imagem da mensagem, não. */
export function notificationPreview<T extends object | undefined>(
  settings: PageNotificationSettings,
  options: T,
): T | (T & { body: string; image: undefined }) {
  if (!settings.hidePreview) return options;
  return { ...(options || {}), body: "Nova mensagem", image: undefined } as T & { body: string; image: undefined };
}

/** Chaves do usuário (geral + do serviço), sem o horário. */
export function serviceNotificationsOn(settings: NotificationSettings, serviceId: string): boolean {
  return serviceId !== "crm" && settings.enabled && settings.serviceEnabled[serviceId] !== false;
}

export function shouldAllowServiceNotification(
  settings: NotificationSettings,
  serviceId: string,
  hour: number = new Date().getHours(),
): boolean {
  if (!serviceNotificationsOn(settings, serviceId)) return false;
  return !(settings.quietHours && isQuietHour(hour, settings.quietFromHour, settings.quietToHour));
}

export const UNREAD_BLIP_MS = 2 * 60 * 1000;

/**
 * Recarregar ou acordar a aba (hibernação, crash, auto-update do WhatsApp) passa
 * pelo título sem contador ("WhatsApp") antes de voltar ao "(5) WhatsApp". Esse
 * 0→5 é o mesmo 5 de antes, não mensagem nova; avisar de novo fazia a
 * notificação "voltar" depois de Limpar.
 *
 * ponytail: janela de tempo. Ler tudo no celular e receber de novo em até 2 min,
 * com contagem ≤ a anterior, não entra no sino (o aviso nativo do WhatsApp sai
 * igual). Trocar por sinal de boot da página se isso incomodar.
 */
export function isUnreadReloadBlip(
  lastDrop: { count: number; at: number } | undefined,
  unread: number,
  now = Date.now(),
): boolean {
  return Boolean(lastDrop && now - lastDrop.at < UNREAD_BLIP_MS && unread <= lastDrop.count);
}

/**
 * Base de "Limpar notificações" depois de o contador do título ir de `prev` a
 * `raw`. O contador visível é `raw - base`: só o que chegou depois de limpar.
 *
 * - Ler parte do que havia baixa a base junto, para a próxima mensagem contar.
 * - Zerar não apaga a base: recarga e hibernação passam pelo título sem contador.
 *   Se o número volta igual ou maior dentro da janela de recarga, é o mesmo; se
 *   volta menor, ou depois da janela, tudo foi lido no meio e o que há é novo.
 * - Sem queda registrada (app recém-aberto), o primeiro número não apaga a base.
 *
 * ponytail: mesma janela de tempo de isUnreadReloadBlip; acordar a aba depois
 * de 2 min reexibe o contador antigo.
 */
export function nextClearedUnread(
  cleared: number | undefined,
  prev: number,
  raw: number,
  lastDrop: { count: number; at: number } | undefined,
  now = Date.now(),
): number | undefined {
  if (cleared === undefined || raw === 0) return cleared;
  if (prev === 0) {
    if (!lastDrop) return Math.min(cleared, raw);
    const reload = now - lastDrop.at < UNREAD_BLIP_MS && raw >= lastDrop.count;
    return reload ? cleared : undefined;
  }
  return Math.min(cleared, raw);
}

/**
 * Injetado no WhatsApp e no Gmail: aplica a chave de notificações do app,
 * silencia conversa muda e faz o clique focar o serviço certo. No Gmail as
 * partes de conversa não encontram nada e viram no-op — não vale um segundo
 * script só para isso.
 */
export function buildNotificationGuard(settingsJson: string, serviceId: string): string {
  const sid = JSON.stringify(serviceId);
  return `(() => {
    if (window.__adrNotifGuard) return "already";
    window.__adrNotifGuard = true;
    window.__adrNotifSettings = ${settingsJson};
    window.__adrServiceId = ${sid};
    const Orig = window.Notification;
    // Toast entregue ao Windows fica na Central de Notificações até alguém
    // fechá-lo. "Limpar" só esvaziava o sino do app e deixava esses lá.
    // Guardamos as vivas para poder fechá-las de verdade.
    const live = new Set();
    window.__adrCloseNotifs = () => {
      for (const n of live) {
        try { n.close(); } catch (_) {}
      }
      live.clear();
      return true;
    };
    // Linha da conversa na lista lateral, casada pelo título da notificação.
    // Serve para dois usos: saber se está silenciada e abri-la no clique.
    // Casamento por substring só a partir de 4 caracteres: com nome curto
    // ("Ana") ele acertaria a conversa errada e engoliria uma notificação real.
    const fuzzy = (a, b) => a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a));
    function chatRow(title) {
      const needle = String(title || "").split("|")[0].trim().toLowerCase();
      if (!needle) return null;
      for (const row of document.querySelectorAll('#pane-side [role="listitem"], #pane-side [role="row"], #pane-side [data-testid="cell-frame-container"]')) {
        const name = String(row.querySelector("span[title]")?.getAttribute("title") || "")
          .trim()
          .toLowerCase();
        if (name && (name === needle || fuzzy(name, needle))) return row;
      }
      return null;
    }
    function chatMuted(title) {
      try {
        const settings = window.__adrNotifSettings || {};
        if (!settings.respectWhatsAppMute) return false;
        // O Store interno sumiu das builds atuais do WhatsApp Web, e sem fallback
        // "respeitar silenciado" virava no-op silencioso. A lista de conversas
        // marca a conversa silenciada com o ícone "muted" — sinal independente
        // de idioma.
        const row = chatRow(title);
        if (
          row &&
          row.querySelector('[data-icon*="muted" i],[aria-label*="silenciad" i],[aria-label*="muted" i]')
        ) {
          return true;
        }
        const needle = String(title || "").split("|")[0].trim().toLowerCase();
        if (!needle) return false;
        const store = window.Store;
        const chats =
          (store && store.Chat && (store.Chat.getModelsArray
            ? store.Chat.getModelsArray()
            : store.Chat.models)) || [];
        const now = Math.floor(Date.now() / 1000);
        for (const chat of chats) {
          const name = String(
            chat.formattedTitle || chat.name || chat.contact?.name || chat.contact?.pushname || ""
          ).trim().toLowerCase();
          if (!name || (name !== needle && !fuzzy(name, needle))) continue;
          const exp = Number(chat.muteExpiration || chat.mute?.expiration || 0);
          if (exp === -1 || exp > now) return true;
        }
      } catch (_) {}
      return false;
    }
    // Não perturbe avaliado na HORA da notificação. Calculado na injeção, o
    // app aberto às 7h30 com silêncio até as 8h ficava mudo o dia inteiro.
    const isQuietHour = ${isQuietHour.toString()};
    const notificationSilenced = ${notificationSilenced.toString()};
    const notificationPreview = ${notificationPreview.toString()};
    function Patched(title, options) {
      const settings = window.__adrNotifSettings || {};
      // Não perturbe por horário, desligado, ou reunião do Meet em curso
      // (meetingQuiet, mantido pelo app enquanto a chamada dura).
      if (notificationSilenced(settings, new Date().getHours())) {
        return { close() {}, addEventListener() {}, removeEventListener() {}, onclick: null, onshow: null, onerror: null, onclose: null };
      }
      if (chatMuted(title)) {
        return { close() {}, addEventListener() {}, removeEventListener() {}, onclick: null, onshow: null, onerror: null, onclose: null };
      }
      const n = new Orig(title, notificationPreview(settings, options));
      live.add(n);
      try {
        n.addEventListener("close", () => live.delete(n));
        // addEventListener, não onclick: o WhatsApp atribui o próprio onclick
        // depois de construir a notificação e apagaria o nosso.
        n.addEventListener("click", () => {
          if (location.hostname === "web.whatsapp.com") {
            // O main abre depois de mostrar a view e validar o PIN. O onclick
            // original do WhatsApp continua livre para navegar pelo ID interno.
            console.log("ADR_OPEN_WHATSAPP_CHAT:" + JSON.stringify({
              serviceId: window.__adrServiceId || "", title: String(title || "")
            }));
          } else {
            console.log("ADR_FOCUS_SERVICE:" + (window.__adrServiceId || ""));
          }
        });
      } catch (_) {}
      return n;
    }
    // Getter, não cópia: o valor era congelado no momento da injeção e a página
    // continuava lendo "default" depois de o usuário conceder a permissão.
    Object.defineProperty(Patched, "permission", { get: () => Orig.permission });
    Patched.requestPermission = Orig.requestPermission.bind(Orig);
    window.Notification = Patched;
    // A página também notifica por registration.showNotification() (Gmail): o
    // check de permissão dela tem webContents, então o "não perturbe" que vale
    // no service worker não a alcança. Mesmas regras do Patched acima.
    const Registration = window.ServiceWorkerRegistration;
    const origShow = Registration && Registration.prototype && Registration.prototype.showNotification;
    if (typeof origShow === "function") {
      // Sem a checagem de conversa silenciada do Patched: ela olha a lista do
      // WhatsApp, e quem usa showNotification aqui é o Gmail.
      Registration.prototype.showNotification = function (title, options) {
        const settings = window.__adrNotifSettings || {};
        if (notificationSilenced(settings, new Date().getHours())) return Promise.resolve();
        return origShow.call(this, title, notificationPreview(settings, options));
      };
    }
    return "ok";
  })()`;
}

/** Executado somente após mostrar/desbloquear a sessão que recebeu o aviso. */
export function openWhatsAppNotificationChatScript(title: string): string {
  return `(() => {
    if (location.hostname !== "web.whatsapp.com") return Promise.resolve(false);
    const title = ${JSON.stringify(title)};
    const normalize = (value) => String(value || "").replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim().toLocaleLowerCase();
    // Nome inteiro primeiro: contato salvo como "Juliana Amaral | WayStar" tem o
    // "|" no PRÓPRIO nome, e cortar ali nunca achava a conversa. O pedaço antes do
    // "|" só vale se nenhuma conversa tiver o título inteiro.
    const full = normalize(title);
    const short = normalize(title.split("|")[0]);
    if (!full) return Promise.resolve(false);
    const nameOf = (node) => normalize(node.getAttribute("title") || node.textContent);
    const matchesAny = (node) => {
      const name = nameOf(node);
      return name === full || (short && name === short);
    };
    // A conversa aberta: o nome no cabeçalho. Sem depender só de span[title]
    // (o WhatsApp muda o cabeçalho), o texto do cabeçalho também serve.
    const isOpen = () => {
      if ([...document.querySelectorAll('#main header span[title]')].some(matchesAny)) return true;
      const header = document.querySelector ? document.querySelector('#main header') : null;
      const text = header ? normalize(header.textContent) : "";
      return Boolean(text) && (text.startsWith(full) || (Boolean(short) && text.startsWith(short)));
    };
    const searchText = (title.split("|")[0] || title).trim();
    return new Promise((resolve) => {
      let attempts = 0;
      let searched = false;
      let clicked = false;
      const tryOpen = () => {
        // O onclick nativo pode ter aberto a conversa enquanto a aba ganhava foco.
        if (isOpen()) {
          resolve(true);
          return;
        }
        const exact = new Set();
        const partial = new Set();
        for (const row of document.querySelectorAll('#pane-side [role="listitem"], #pane-side [role="row"], #pane-side [data-testid="cell-frame-container"]')) {
          for (const name of row.querySelectorAll('span[title]')) {
            const value = nameOf(name);
            if (value === full) exact.add(name);
            else if (short && value === short) partial.add(name);
          }
        }
        const targets = exact.size ? exact : partial;
        // Só nome exato e único: "Ana" não abre "Ana Silva"; homônimos ficam
        // para o onclick nativo, que conhece o ID da conversa.
        if (targets.size === 1 && !clicked) {
          clicked = true;
          const target = [...targets][0];
          target.scrollIntoView?.({ block: "nearest" });
          // React também pode abrir a linha no mousedown; HTMLElement.click()
          // sozinho não produz esse evento.
          target.dispatchEvent?.(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, buttons: 1 }));
          target.dispatchEvent?.(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
          target.click();
          if (isOpen()) {
            resolve(true);
            return;
          }
        }
        // Uma lista rolada/filtrada pode não ter a conversa no DOM. Depois de
        // dar tempo ao onclick nativo, use a busca lateral (nunca o editor).
        if (!searched && targets.size === 0 && attempts >= 2) {
          searched = true;
          const search = [...document.querySelectorAll('#side [role="textbox"], #side input[type="text"]')].find((node) =>
            node.getAttribute("data-tab") === "3" || /search|pesquis|buscar/i.test(node.getAttribute("aria-label") || "")
          );
          if (search && search.isContentEditable) {
            search.focus();
            const range = document.createRange();
            range.selectNodeContents(search);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            document.execCommand("insertText", false, searchText);
          } else if (search && search.tagName === "INPUT") {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
            setter.call(search, searchText);
            search.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }
        // Clicou na linha certa (nome exato e único) e o cabeçalho não confirmou:
        // a conversa abriu do mesmo jeito — avisar "não encontrei" seria falso.
        if (++attempts >= 20) resolve(clicked);
        else setTimeout(tryOpen, 200);
      };
      tryOpen();
    });
  })()`;
}

/**
 * Fecha os toasts que o WhatsApp/Gmail já entregaram ao SO, tirando-os da
 * Central de Notificações do Windows. É outra coisa que o contador do ícone
 * (`app.setBadgeCount`, ver refreshTrayBadge): aquele conta mensagem não lida,
 * este limpa aviso já entregue. "Limpar" mexe nos dois.
 */
export const CLOSE_OS_NOTIFICATIONS_SCRIPT = `(() => Boolean(window.__adrCloseNotifs && window.__adrCloseNotifs()))()`;

export function notificationSettingsPatchScript(settingsJson: string): string {
  return `(() => { window.__adrNotifSettings = ${settingsJson}; return true; })()`;
}
