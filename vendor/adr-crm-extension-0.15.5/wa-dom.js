// ponytail: TODOS os seletores do WhatsApp Web ficam aqui. Eles são frágeis e a
// Meta muda o DOM sem aviso — quando algo parar de funcionar, recalibrar SÓ neste
// arquivo. Upgrade path: se a leitura por DOM virar impossível, injetar um script no
// contexto da página para ler o Store interno do WhatsApp (mais robusto, mais trabalho).

// Seletores do player de nota de voz — ÚNICO ponto de verdade (usado em isIncomingRow,
// isAudioBubble, audioBox). A Meta migrou ícones para o design system ("wds-ic-*", ver
// sendButton), então casamos por SUBSTRING de "ptt"/"audio" além dos nomes antigos: um
// rename de build deixa de sumir com o botão de transcrever. ponytail: recalibrar só aqui.
const AUDIO_ICON_SEL =
  '[data-icon="ptt-status"],[data-icon*="ptt" i],[data-icon*="audio" i]';
// Setinha de enviar — mesmos sinais no rodapé e na prévia de mídia. ponytail:
// recalibrar só aqui se a Meta renomear o ícone/rótulo.
const SEND_SEL =
  '[data-icon="wds-ic-send-filled"],[data-icon="send"],[data-icon="send-light"],' +
  'button[aria-label="Enviar"],button[aria-label="Send"]';

// Rótulos do campo de legenda e dos campos de BUSCA (o diálogo de encaminhar também
// tem editável + setinha de enviar; sem esta distinção o interceptor sequestraria a
// busca dele). ponytail: recalibrar só aqui.
const CAPTION_HINT = /legenda|caption|leyenda/i;
const SEARCH_HINT = /pesquis|search|busca/i;

const AUDIO_ARIA_SEL =
  '[aria-label*="mensagem de voz" i],[aria-label*="voice message" i],' +
  '[aria-label*="reproduzir mensagem de voz" i],[aria-label*="play voice message" i]';

const CRMWADom = {
  main() {
    return document.querySelector("#main");
  },

  // Nome/número do contato/grupo da conversa aberta. O cabeçalho tem 2 linhas: nome
  // (topo) e presença ("online"/"digitando…"). Em algumas builds o span do nome perde o
  // `title` e o 1º span[title] passa a ser a presença — por isso NÃO basta pegar o 1º
  // span[title]. Percorre em ordem de DOM (nome vem antes) e ignora textos de presença.
  // ponytail: lista de presença por regex; recalibrar só aqui se a Meta mudar os rótulos.
  headerTitle() {
    const header = document.querySelector("#main header");
    if (!header) return "";
    const isPresence = (t) =>
      /^(online|digitando|gravando|typing|recording|visto por último|last seen|aguardando|clique aqui)/i.test(t);
    for (const s of header.querySelectorAll('span[title], span[dir="auto"]')) {
      const val = (s.getAttribute("title") || s.textContent || "").trim();
      if (val && !isPresence(val)) return val; // title p/ nomes truncados; senão o texto
    }
    return "";
  },

  // Primeiro botão de enviar VISÍVEL do escopo. `skipFooter` existe porque, subindo a
  // árvore a partir da legenda, um ancestral alto acaba contendo TAMBÉM o rodapé:
  // clicar na setinha de lá mandaria a mensagem da conversa, não o anexo.
  sendButtonIn(scope, skipFooter = false) {
    if (!scope) return null;
    for (const el of scope.querySelectorAll(SEND_SEL)) {
      if (skipFooter && el.closest("#main footer")) continue;
      const btn = el.closest("button") || el.closest('[role="button"]') || el;
      if (this.isVisible(btn)) return btn;
    }
    return null;
  },

  isVisible(el) {
    if (!el?.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  },

  // Composer da legenda do anexo (prévia de imagem/vídeo/documento). Ele vive FORA de
  // `#main footer` e tem setinha de enviar PRÓPRIA — por isso o interceptor de
  // auto-tradução não via a legenda e ela saía em pt-BR.
  // Sinais: o rótulo "legenda" quando a Meta o expõe; senão o PAR que só a prévia
  // forma — editável visível fora do rodapé/lista + setinha de enviar dele na árvore.
  // Não dependemos mais de data-testid nem de role=dialog: os dois mudam a cada build,
  // e o container que sobrava (parentElement do campo) NÃO continha o botão — a
  // legenda até era traduzida, mas o envio não achava a setinha.
  // ponytail: recalibrar só aqui. Upgrade path: ler o Store interno pelo MAIN world.
  captionComposer() {
    const label = (el) =>
      (el.getAttribute("aria-label") || "") + " " + (el.getAttribute("aria-placeholder") || "");
    const candidates = [...document.querySelectorAll('div[contenteditable="true"]')].filter(
      (el) => this.isVisible(el) && !el.closest("#main footer") && !el.closest("#side"),
    );
    return (
      candidates.find((el) => CAPTION_HINT.test(label(el))) ||
      candidates.find((el) => !SEARCH_HINT.test(label(el)) && this.captionScope(el)) ||
      null
    );
  },

  // Menor ancestral da legenda que também contém a setinha de enviar DELA.
  captionScope(el) {
    for (let node = el?.parentElement; node && node !== document.body; node = node.parentElement) {
      if (this.sendButtonIn(node, true)) return node;
    }
    return null;
  },

  // Container da prévia: escopo da legenda (usado também para achar o popup de menção).
  mediaPreviewContainer() {
    const el = this.captionComposer();
    return el ? this.captionScope(el) : null;
  },

  captionSendButton() {
    return this.sendButtonIn(this.mediaPreviewContainer(), true);
  },

  mainComposer() {
    return (
      document.querySelector('#main footer div[contenteditable="true"][role="textbox"]') ||
      document.querySelector('#main footer div[contenteditable="true"]')
    );
  },

  // Composer ATIVO. O preview de mídia vence o rodapé porque, com ele aberto, é dele
  // que sai a mensagem. Toda a maquinaria transacional (setComposerText, guards de
  // contexto, rollback) passa por aqui e por isso cobre legenda sem duplicação.
  composer() {
    return this.captionComposer() || this.mainComposer();
  },

  // Onde o envio está acontecendo agora. Só para mensagem de erro precisa: o usuário
  // precisa saber se a falha foi no texto da conversa ou na legenda do anexo.
  activeSendSurface() {
    return this.captionComposer() ? "caption" : "main";
  },

  footer() {
    return document.querySelector("#main footer");
  },

  // Botão de enviar (a setinha). Só existe quando há texto no composer.
  // Ícone atual: wds-ic-send-filled (validado no WhatsApp Business Web).
  sendButton() {
    return this.captionSendButton() || this.sendButtonIn(this.footer());
  },

  clickSend() {
    const btn = this.sendButton();
    if (!btn) return false;
    btn.click();
    return true;
  },

  // É o composer da conversa? (para interceptar o Enter só nele)
  isComposer(node) {
    const el = this.composer();
    return !!el && (node === el || el.contains(node));
  },

  // O WhatsApp abre um popup de sugestões ao digitar @ (menção) ou : (emoji). Dentro dele,
  // Enter SELECIONA a sugestão — NÃO envia. O auto-envio não pode confundir esse Enter com
  // um envio: se traduzir aí, pega a mensagem pela metade e injeta a tradução no meio do
  // chip de menção (texto embaralhado no campo, ex.: "@RHey Suki...enan"). Sinais: o editor
  // ganha aria-activedescendant apontando pra opção ativa; e há um listbox/option VISÍVEL no
  // #main (o popup do WhatsApp), fora da nossa UI (que mora no document.body).
  // ponytail: recalibrar só aqui se a Meta mudar o markup do autocomplete.
  isSuggestionOpen() {
    const c = this.composer();
    if (c && c.getAttribute("aria-activedescendant")) return true;
    // Com o preview de mídia aberto, o popup de menção da legenda mora nele, não no
    // `#main` — procurar só no `#main` deixaria o Enter de seleção virar envio.
    const scopes = [document.querySelector("#main"), this.mediaPreviewContainer()].filter(Boolean);
    for (const scope of scopes) {
      for (const el of scope.querySelectorAll('[role="listbox"], [role="option"]')) {
        if (this.isVisible(el)) return true;
      }
    }
    return false;
  },

  // Esta build do WhatsApp (Business) não usa mais .message-in/.message-out — as
  // mensagens são div[role="row"] com classes ofuscadas que mudam por build.
  // Sinal DEFINITIVO quando há data-id: o balão começa com "<fromMe>_" (true_=enviada,
  // false_=recebida). É à prova de layout — o alinhamento sozinho INVERTE em nota de voz,
  // cujo ícone de status fica sobre o avatar (lado oposto do balão). Sem fromMe, cai para
  // alinhamento ancorado no BALÃO (container data-id) ou no texto, nunca no ícone de áudio.
  // ponytail: recalibrar só aqui se a Meta mudar o formato do data-id ou centralizar bolhas.
  // data-id do BALÃO PRINCIPAL da linha, ignorando o data-id ANINHADO da prévia de uma
  // resposta citada (que tem fromMe do autor citado e inverteria remetido/recebido). O
  // principal é o data-id mais externo — nenhum ancestral é [data-id].
  primaryDataIdEl(row) {
    for (const el of row.querySelectorAll("[data-id]")) {
      if (el.parentElement && el.parentElement.closest("[data-id]")) continue; // citação aninhada
      return el;
    }
    return null;
  },

  isIncomingRow(row) {
    const main = this.main();
    if (!main) return false;
    const idEl = this.primaryDataIdEl(row);
    const rawId = idEl?.getAttribute("data-id") || "";
    if (rawId.startsWith("true_")) return false;
    if (rawId.startsWith("false_")) return true;
    const inner =
      idEl ||
      row.querySelector(".copyable-text") ||
      row.querySelector("span.selectable-text") ||
      row.querySelector("[data-pre-plain-text]");
    if (!inner) return false;
    const rb = inner.getBoundingClientRect();
    if (!rb.width) return false;
    const mb = main.getBoundingClientRect();
    const leftGap = rb.left - mb.left;
    const rightGap = mb.right - rb.right;
    return leftGap < rightGap;
  },

  // Todas as mensagens da conversa aberta, recebidas e enviadas.
  visibleBubbles() {
    return [...document.querySelectorAll('#main div[role="row"]')];
  },

  // Endereços de e-mail no texto de uma mensagem: sem repetição (ignorando
  // maiúsculas) e no máximo 3, para a bolha não virar uma lista de botões.
  // O TLD termina em letra, então o ponto final da frase fica de fora.
  emailsInText(text) {
    const found =
      String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi) || [];
    const seen = new Set();
    const emails = [];
    for (const email of found) {
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      emails.push(email);
    }
    return emails.slice(0, 3);
  },

  // Mensagens recebidas ainda sem botão de tradução.
  newIncomingBubbles() {
    return this.visibleIncomingBubbles();
  },

  // Todas as mensagens recebidas atualmente no DOM (WhatsApp só monta as visíveis).
  visibleIncomingBubbles() {
    return [...document.querySelectorAll('#main div[role="row"]')].filter((r) => this.isIncomingRow(r));
  },

  // Texto de uma bolha. Tenta vários seletores porque o WhatsApp varia a estrutura.
  // Ignora a prévia de uma resposta citada ([aria-label], ex.: "Mensagem citada"):
  // a duração "0:16" de uma NOTA DE VOZ citada NÃO é texto desta bolha — contá-la
  // mascarava a bolha de áudio como se fosse texto e sumia com o botão de transcrever
  // (validado ao vivo 2026-07-23). Mensagem própria nunca fica sob [aria-label].
  // ponytail: recalibrar o seletor de citação só aqui se a Meta mudar o rótulo.
  bubbleText(bubble) {
    const notQuoted = (el) => el && !el.closest("[aria-label]");
    const pick = (sel) => [...bubble.querySelectorAll(sel)].find(notQuoted);
    const el =
      pick(".copyable-text .selectable-text") ||
      pick("span.selectable-text") ||
      pick(".selectable-text");
    return el ? (el.textContent || "").trim() : "";
  },

  // innerText, não textContent: o Lexical renderiza cada linha como bloco e o
  // textContent CONCATENA tudo sem separador — mensagem multilinha nunca casaria
  // na verificação (e o texto lido para traduzir perdia as quebras).
  // Fallback textContent: ambientes sem innerText (JSDOM dos testes).
  composerReadText(el) {
    return (el && (el.innerText ?? el.textContent)) || "";
  },

  composerText() {
    const el = this.composer();
    return el ? this.composerReadText(el) : "";
  },

  composerSnapshot() {
    const el = this.composer();
    return el ? { element: el, text: this.composerReadText(el) } : null;
  },

  composerHasStructuredContent(el = this.composer()) {
    if (!el) return false;
    return !!el.querySelector(
      '[contenteditable="false"],[data-mention-jid],[data-jid],[data-lexical-decorator="true"]'
    );
  },

  // Seleciona tudo, espera o Lexical sincronizar a seleção e cola (ou limpa via cut).
  // VALIDADO AO VIVO (2026-07-10): a seleção interna do Lexical sincroniza do DOM de
  // forma ASSÍNCRONA (selectionchange). Disparar o paste no MESMO tick do selectAll
  // cola na seleção interna antiga (colapsada no fim) e ANEXA em vez de substituir —
  // era o PT+EN acumulado no campo. Com 1 tick entre os passos, substitui limpo
  // mesmo sobre chip de link e mensagem longa. Paste vazio é no-op no Lexical.
  async composerPasteAll(el, text, guard = () => true) {
    if (!guard() || !el?.isConnected || this.composer() !== el) return false;
    const selection = window.getSelection();
    el.focus();
    selection?.removeAllRanges();
    selection?.selectAllChildren(el);
    await new Promise((r) => setTimeout(r, 60));
    if (!guard() || !el.isConnected || this.composer() !== el) return false;
    if (text) {
      const clipboard = new DataTransfer();
      clipboard.setData("text/plain", text);
      el.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: clipboard })
      );
    } else {
      el.dispatchEvent(
        new ClipboardEvent("cut", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() })
      );
    }
    await new Promise((r) => setTimeout(r, 60));
    return guard() && el.isConnected && this.composer() === el;
  },

  // Rollback: recoloca o TEXTO do snapshot pelo mesmo mecanismo comprovado.
  // (innerHTML direto dessincroniza o modelo interno do Lexical — o editor
  // reconciliava por cima e a tentativa falha ficava anexada ao original.)
  async restoreComposer(snapshot, guard = () => true) {
    const el = snapshot?.element;
    if (!guard() || !el?.isConnected || this.composer() !== el) return false;
    if (!(await this.composerPasteAll(el, snapshot.text || "", guard))) return false;
    return window.CRMWAUtils.isSameComposerText(this.composerReadText(el), snapshot.text);
  },

  // Substitui o composer de forma transacional: mecanismo único comprovado ao vivo
  // (selectAll → tick → paste/cut → tick → verificação), com 1 retry e rollback.
  async setComposerText(text, expectedElement = null, guard = () => true) {
    const el = this.composer();
    if (!guard() || !el || (expectedElement && el !== expectedElement)) return { ok: false, snapshot: null };
    const snapshot = this.composerSnapshot();
    const target = String(text || "");
    if (window.CRMWAUtils.isSameComposerText(snapshot?.text, target)) {
      return { ok: true, snapshot };
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      // Falhar DEPOIS do paste pode deixar o campo alterado: cai no rollback abaixo.
      if (!(await this.composerPasteAll(el, target, guard))) break;
      if (window.CRMWAUtils.isSameComposerText(this.composerReadText(el), target)) {
        return { ok: true, snapshot };
      }
    }
    // `restored` diz ao chamador se o original voltou; sem ele a UI afirmava
    // "original preservado" com o campo meio alterado.
    const restored =
      window.CRMWAUtils.isSameComposerText(this.composerReadText(el), snapshot?.text) ||
      (await this.restoreComposer(snapshot, guard));
    return { ok: false, snapshot, restored };
  },

  // Mensagem de áudio (nota de voz). O áudio NÃO é extraível do DOM (Web Audio, sem
  // <audio>/blob), mas não precisa: o servidor rebaixa a mídia pela gateway/Baileys a
  // partir do id da mensagem (ver bubbleExternalId + content.js).
  // ponytail: ptt-status é independente de idioma (sinal primário). As arias pt/en são
  // só reforço — se mudarem, o data-icon ainda detecta. Recalibrar o icon só aqui.
  isAudioBubble(bubble) {
    return !!bubble.querySelector(AUDIO_ICON_SEL + "," + AUDIO_ARIA_SEL + ",audio");
  },

  // Container (com data-id) que envolve o player de áudio — bom ponto pra ancorar a UI
  // de transcrição centralizada sob a forma de onda (em vez da linha inteira).
  audioBox(bubble) {
    const icon = bubble.querySelector(AUDIO_ICON_SEL);
    return (icon && icon.closest("[data-id]")) || null;
  },

  // Id da mensagem no WhatsApp (key.id, o "3EB0..." do data-id) — é o externalMessageId
  // no CRM. O data-id tem o formato `<fromMe>_<jid>_<id>[_<participant>]`; jid e id não
  // têm "_", então a 3ª parte é o id. closest() PRIMEIRO (o container é ancestral); o
  // querySelector é fallback e poderia pegar o data-id de uma resposta citada embutida,
  // por isso vem depois. Valida o formato pra não mandar lixo ao servidor.
  bubbleExternalId(bubble) {
    // Ancora no container com data-id que ENVOLVE o player de áudio (via o ícone), pra
    // não pegar o data-id de uma resposta citada embutida. Cai para ancestral/descendente.
    const icon = bubble.querySelector(AUDIO_ICON_SEL);
    const el =
      (icon && icon.closest("[data-id]")) ||
      this.primaryDataIdEl(bubble) ||
      bubble.closest("[data-id]");
    const raw = el?.getAttribute("data-id") || "";
    // O data-id varia por build: "false_<jid>_<keyid>[_<participant>]" OU só "<keyid>".
    // O keyid é a parte alfanumérica que não é true/false nem um jid (contém "@").
    const id =
      raw
        .split("_")
        .find(
          (p) => p !== "true" && p !== "false" && !p.includes("@") && /^[A-Za-z0-9.\-=+/]{6,64}$/.test(p)
        ) || "";
    return id;
  },

  // ponytail: WhatsApp Web em locale pt-BR usa 24h ("[14:05, 21/7/2026]"); em
  // inglês/outros locales usa 12h com AM/PM ("[2:05 PM, 7/21/2026]"). Sem aceitar o
  // sufixo, bubbleSentAtMs voltava null e a auto-transcrição ficava inerte em silêncio
  // nesses idiomas. Sem match nenhum, continua retornando null (mesmo fallback seguro).
  bubbleSentAtMs(bubble) {
    const raw = bubble.querySelector("[data-pre-plain-text]")?.getAttribute("data-pre-plain-text") || "";
    const match = raw.match(/\[(\d{1,2}):(\d{2})\s*([AaPp][Mm])?,\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\]/);
    if (!match) return null;
    const [, hourRaw, minute, meridiem, first, second, year] = match;
    // pt-BR é D/M ("21/7/2026"), en-US é M/D ("7/21/2026"). Componente > 12 decide;
    // ambíguo, vale o idioma da página. ponytail: só en-US/"en" são M/D; outro locale
    // M/D cai em D/M e a auto-transcrição deixa de disparar (nunca dispara a mais).
    const lang = document.documentElement?.lang || globalThis.navigator?.language || "";
    const monthFirst =
      Number(first) > 12 ? false : Number(second) > 12 ? true : /^en(-us)?$/i.test(lang);
    const [day, month] = monthFirst ? [second, first] : [first, second];
    let hour = Number(hourRaw);
    if (meridiem) {
      hour = hour % 12;
      if (/p/i.test(meridiem)) hour += 12;
    }
    const value = new Date(Number(year), Number(month) - 1, Number(day), hour, Number(minute)).getTime();
    return Number.isFinite(value) ? value : null;
  },

  // --- helpers puros ---

  phoneDigits(text) {
    return String(text || "").replace(/\D/g, "");
  },

  // Heurística: o texto já está em português? (para não oferecer "traduzir" em PT).
  // Estratégia (validada no WhatsApp real): ã/õ/ç são sinais fortes de PT; fora isso,
  // tiramos os acentos (senão \b quebra com letra acentuada em JS) e batemos contra
  // palavras DISTINTIVAS do PT — que não existem em espanhol — para que espanhol e
  // inglês continuem mostrando "traduzir". Só esconde quando há sinal claro de PT.
  // ponytail: heurística por lista; upgrade para a LanguageDetector API do Chrome quando
  // ela estiver disponível em content scripts (hoje, Chrome 149, ainda não expõe).
  looksPortuguese(text) {
    const orig = " " + String(text || "").toLowerCase() + " ";
    if (/[ãõç]/.test(orig)) return true;
    const t = orig.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return /\b(nao|mas|uma|voce|vc|vcs|vou|tem|fazer|faz|fez|coisa|muito|entao|tambem|ninguem|alguem|fechou|fechar|queria|quero|conteudo|fica|ficou|ficar|beleza|valeu|blz|vlw|pra|pro|dela|dele|deles|delas|isso|isto|assim|dizer|disse|vendo|achei|acho|acha|deu|manda|mandou|falou|fala|falar|sei|tava|agora|outra|outro|bora|demais|obrigad[oa]?|legal|cara|entendi|consegue|consigo|conseguir|preciso|precisa|aquela|aquele|divulgar|publi|batemos|gente|senha|teu|tua|dia|dai|cobra|perfil|senao|aqui|ali|sobre|hein|teremos|terei)\b/.test(t);
  },

  // Deve oferecer "traduzir" nesta mensagem? Estratégia (validada no WhatsApp real):
  // só quando a mensagem parece INGLÊS ou ESPANHOL e NÃO parece português. Assim
  // português, e-mails, @handles e textos sem idioma claro não recebem o link.
  // Palavras curtas que colidem entre idiomas (do, me, ok, claro, vale) ficam de fora.
  shouldOfferTranslate(text) {
    const s = String(text || "");
    if (!s.trim()) return false;
    if (this.looksPortuguese(s)) return false;
    if (/[ñ¿¡]/.test(s)) return true; // marcas fortes de espanhol
    const EN =
      /\b(the|you|your|are|is|am|to|too|for|and|have|has|had|will|can|could|would|should|this|that|these|those|with|what|when|where|why|how|who|please|thanks|thank|hello|hi|hey|yes|yeah|we|they|our|their|but|not|don't|does|did|done|get|got|need|want|know|like|good|morning|afternoon|evening|night|new|project|projects|brazil|let|us|about|out|reach|contact|influencer|influencers|brand|payment|course|sure|here|there|soon|today|tomorrow|working|work|help|message|number|right)\b/i;
    const ES =
      /\b(hola|gracias|usted|ustedes|se[ñn]or|se[ñn]ora|buenos|buenas|adi[oó]s|nosotros|qu[eé]|c[oó]mo|est[aá]s|tambi[eé]n|tienes|tiene|hacer|disculpa|perd[oó]n|muy|pero|bien)\b/i;
    return EN.test(s) || ES.test(s);
  },

  // Heurística: título do cabeçalho é um número (contato não salvo), não um nome.
  looksLikePhone(text) {
    const t = String(text || "").trim();
    if (!/[+\d]/.test(t[0] || "")) return false; // nome começa com letra
    const digits = this.phoneDigits(t);
    return digits.length >= 8 && digits.length <= 15 && !/[a-zA-ZÀ-ÿ]/.test(t);
  },

  // Tema do WhatsApp (claro/escuro) por luminância do fundo — para casar a UI.
  isDark() {
    const bg = getComputedStyle(document.body).backgroundColor || "";
    const m = bg.match(/\d+/g);
    if (!m || m.length < 3) return true;
    const [r, g, b] = m.map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
  },
};

window.CRMWADom = CRMWADom;
