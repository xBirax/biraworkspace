(() => {
  if (window.top !== window || document.getElementById('adr-gmail-assistant')) return;

  const host = document.createElement('div');
  host.id = 'adr-gmail-assistant';
  // Canto inferior ESQUERDO: no direito o Gmail encaixa as janelas de "Escrever"
  // (lixeira e "Mais opções" do rascunho) e a seta do painel lateral do Google,
  // e o botão ficava por cima delas. Na esquerda só há a lista de marcadores,
  // que rola por baixo.
  host.style.cssText = 'position:fixed;left:18px;bottom:18px;z-index:2147483647';
  // Gmail page scripts must not read the panel fields or trigger its controls.
  const root = host.attachShadow({ mode: 'closed' });
  // O Gmail exige Trusted Types: atribuir HTML como string (innerHTML) é
  // bloqueado ("This document requires 'TrustedHTML' assignment") e o painel
  // nunca montava — no Electron o mundo isolado do preload também obedece. Tudo
  // aqui é criado elemento a elemento; <style> por textContent não é afetado.
  const h = (tag, attrs = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === false || value == null) continue;
      el.setAttribute(key, value === true ? '' : String(value));
    }
    el.append(...children);
    return el;
  };
  const option = (value, text) => h('option', { value }, text);
  const labeled = (text, control) => h('label', {}, h('span', {}, text), control);
  const button = (id, text, attrs = {}) => h('button', { id, type: 'button', ...attrs }, text);
  const style = document.createElement('style');
  style.textContent = `
    :host { font: 13px Arial,sans-serif; color:#e9f1fa; }
    button,input,textarea,select { font:inherit; }
    button { cursor:pointer; border:1px solid #30445c; border-radius:8px; background:#17263a; color:#fff; padding:8px 10px; }
    button:hover { border-color:#55caaa; } button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible { outline:2px solid #64d7ae; outline-offset:2px; }
    button:disabled { opacity:.55; cursor:wait; }
    #toggle { background:#0c9f79; color:#071b18; font-weight:700; box-shadow:0 8px 24px #0005; }
    #panel { display:none; width:min(370px,calc(100vw - 36px)); max-height:min(720px,calc(100vh - 70px)); overflow:auto; margin-bottom:8px; padding:16px; box-sizing:border-box; background:#101a2b; border:1px solid #34435e; border-radius:14px; box-shadow:0 18px 50px #0008; }
    #panel.open { display:block; } h2 { margin:0 0 4px; font-size:17px; } p { margin:4px 0 12px; color:#a9bdd2; line-height:1.4; }
    label { display:block; margin-top:12px; font-weight:600; } label span { display:block; margin-bottom:5px; }
    input,textarea,select { width:100%; box-sizing:border-box; border:1px solid #3a4b61; border-radius:8px; background:#17263a; color:#fff; padding:9px; }
    textarea { min-height:75px; resize:vertical; } #preview,#translation { min-height:130px; } #subject { min-height:0; }
    #translation,#copy-translation { margin-top:8px; } .section-title { margin:14px 0 6px; font-weight:600; } [hidden] { display:none !important; }
    .row { display:flex; gap:8px; margin-top:10px; } .row>* { flex:1; }
    .primary { background:#0c9f79; color:#071b18; font-weight:700; }
    #result { margin-top:9px; white-space:pre-wrap; line-height:1.4; }
    #status { min-height:18px; margin:10px 0 0; color:#b4d7f8; }
    .hint { font-size:11px; } a { color:#75dabb; }
  `;
  root.append(
    style,
    h('section', { id: 'panel', role: 'region', 'aria-label': 'ADR CRM no Gmail' },
      h('h2', {}, 'ADR CRM no Gmail'),
      h('p', {}, 'Consulte um contato, traduza e-mails recebidos e prepare e-mails em inglês ou espanhol. O envio continua no Gmail.'),
      labeled('E-mail do contato', h('input', { id: 'contact-email', type: 'email', autocomplete: 'off', placeholder: 'pessoa@empresa.com' })),
      h('div', { class: 'row' }, button('selection', 'Usar e-mail selecionado'), button('lookup', 'Consultar CRM')),
      button('open-crm', 'Abrir CRM'),
      h('div', { id: 'result', 'aria-live': 'polite' }),
      h('div', { class: 'section-title' }, 'E-mail recebido'),
      button('translate-open', 'Traduzir e-mail aberto para português'),
      h('p', { class: 'hint' }, 'Traduz a mensagem recebida mais recente da conversa aberta, ou só o trecho que você selecionar.'),
      h('textarea', { id: 'translation', readonly: true, hidden: true, 'aria-label': 'Tradução para português' }),
      h('div', { class: 'row' },
        button('copy-translation', 'Copiar tradução', { hidden: true }),
        button('translate-prev', 'Traduzir mensagem anterior', { hidden: true })),
      labeled('O que deseja fazer?', h('select', { id: 'mode' },
        option('draft', 'Criar e-mail'), option('rewrite', 'Revisar texto'), option('translate', 'Traduzir texto'))),
      h('div', { class: 'row' },
        labeled('Idioma', h('select', { id: 'language' }, option('en', 'Inglês'), option('es', 'Espanhol'))),
        labeled('Tom', h('select', { id: 'tone' },
          option('professional', 'Profissional'), option('friendly', 'Amigável'), option('concise', 'Direto')))),
      labeled('Assunto atual, se houver', h('input', { id: 'subject', type: 'text', maxlength: 200 })),
      labeled('Instruções em português', h('textarea', { id: 'instructions', maxlength: 1200, placeholder: 'Ex.: agradecer a reunião e pedir retorno até sexta-feira' })),
      labeled('Texto existente, se houver', h('textarea', { id: 'source', maxlength: 6000, placeholder: 'Cole aqui o texto que deseja revisar ou traduzir' })),
      h('div', { class: 'row' }, button('read', 'Usar texto do rascunho'), button('generate', 'Preparar prévia', { class: 'primary' })),
      labeled('Prévia do corpo', h('textarea', { id: 'preview', readonly: true })),
      h('div', { class: 'row' },
        button('copy-subject', 'Copiar assunto', { disabled: true }),
        button('copy', 'Copiar corpo', { disabled: true })),
      h('p', { class: 'hint' }, 'Só o texto que você fornecer será enviado ao assistente. Confira nomes, números e compromissos. Nada é enviado como e-mail automaticamente.'),
      h('p', { id: 'status', role: 'status', 'aria-live': 'polite' })),
    button('toggle', 'ADR CRM', { 'aria-expanded': 'false', 'aria-controls': 'panel' }),
  );
  // Teclas digitadas no painel saem da shadow root com o host como alvo, e o
  // Gmail não sabe que é um campo: "e", "#", "!", "r" viravam atalhos enquanto se
  // escrevia nas instruções. Parar a propagação não impede a digitação.
  for (const type of ['keydown', 'keypress', 'keyup']) root.addEventListener(type, (event) => event.stopPropagation());
  const $ = (id) => root.getElementById(id);
  const say = (message) => { $('status').textContent = message; };
  const clearPreview = () => {
    $('preview').value = '';
    $('copy').disabled = true;
    $('copy-subject').disabled = true;
  };
  for (const id of ['mode', 'language', 'tone', 'subject', 'instructions', 'source']) {
    $(id).addEventListener('input', () => {
      if ($('preview').value) say('Texto alterado. Prepare uma nova prévia antes de copiar.');
      clearPreview();
    });
  }
  $('contact-email').addEventListener('input', () => { $('result').textContent = ''; });
  // Cada conversa só muda o hash (#inbox/<id>): sem ele, as checagens de "mudou
  // de e-mail" nunca disparavam. O "?compose=…" do hash é só um rascunho aberto.
  const gmailLocation = () => `${location.origin}${location.pathname}${location.hash.split('?')[0]}`;
  let selectedAddress = null;
  let lastComposer = null;
  const composerSelector = '[g_editable="true"][contenteditable="true"], [role="textbox"][contenteditable="true"]';
  const isComposer = (editor) => editor?.matches?.('[g_editable="true"][contenteditable="true"]') ||
    Boolean(editor?.closest?.('[role="dialog"]'));
  document.addEventListener('focusin', (event) => {
    const editor = event.target?.closest?.(composerSelector);
    if (editor && isComposer(editor)) lastComposer = editor;
  }, true);
  // Corpo de mensagem aberta no Gmail (seletor interno do Gmail).
  const messageBodySelector = 'div.a3s';
  // Só o texto que a pessoa VÊ na mensagem. innerText não basta: mantém texto
  // escondido por CSS (opacidade 0, fonte minúscula, branco no branco, recortado,
  // fora da caixa), e um e-mail malicioso poria ali um parágrafo que só
  // apareceria na "tradução" do painel. O histórico atrás do "…" é display:none.
  // ponytail: heurística — fundo de imagem pula a checagem de cor e texto coberto
  // por outro elemento passa; endurecer aqui se aparecer e-mail que escape.
  const channels = (color) => (String(color).match(/[\d.]+/g) || []).map(Number);
  const backgroundOf = (el) => {
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== 'none') return null;
      const [r, g, b, a = 1] = channels(style.backgroundColor);
      if (a >= 1) return [r, g, b];
    }
    return [255, 255, 255];
  };
  // `range` = só o trecho selecionado; sem ele, tudo dentro de `scope`.
  const visibleText = (scope, range = null) => {
    const states = new Map();
    // Por elemento, herdado dos ancestrais até o corpo da mensagem: se algo o
    // esconde, a opacidade acumulada, o fundo atrás e as caixas que recortam.
    const stateOf = (el) => {
      if (states.has(el)) return states.get(el);
      const style = getComputedStyle(el);
      const isBody = el.matches(messageBodySelector);
      const up = isBody ? { opacity: 1, hidden: false, clips: [], paper: backgroundOf(el.parentElement) } : stateOf(el.parentElement);
      const [r, g, b, a = 1] = channels(style.backgroundColor);
      const state = {
        style,
        opacity: up.opacity * Number(style.opacity),
        // checkVisibility (Chrome 105+) pega display:none/content-visibility; sem
        // ele, o retângulo vazio do texto cobre o display:none.
        hidden: up.hidden || style.clip !== 'auto' || style.clipPath !== 'none' || el.checkVisibility?.() === false,
        paper: style.backgroundImage !== 'none' ? null : a >= 1 ? [r, g, b] : up.paper,
        clips: isBody || style.overflowX !== 'visible' || style.overflowY !== 'visible'
          ? [...up.clips, el.getBoundingClientRect()] : up.clips,
      };
      states.set(el, state);
      return state;
    };
    const shown = (node) => {
      const state = stateOf(node.parentElement);
      const ink = channels(state.style.webkitTextFillColor || state.style.color);
      // Diferença de cor para o fundo, já atenuada pela opacidade; sem fundo
      // conhecido (imagem), só a opacidade conta.
      const strength = state.opacity * (ink[3] ?? 1);
      const contrast = strength * (state.paper ? Math.max(...state.paper.map((value, i) => Math.abs(ink[i] - value))) : 255);
      if (state.hidden || state.style.visibility !== 'visible' || parseFloat(state.style.fontSize) < 4 || contrast < 40) return false;
      const text = document.createRange();
      text.selectNodeContents(node);
      const box = text.getBoundingClientRect();
      const clips = [box, ...state.clips];
      const width = Math.min(...clips.map((c) => c.right)) - Math.max(...clips.map((c) => c.left));
      const height = Math.min(...clips.map((c) => c.bottom)) - Math.max(...clips.map((c) => c.top));
      return width >= 1 && height >= 4;
    };
    // Quebra de linha ao trocar de bloco (o que innerText faria).
    const blockOf = (el) => {
      while (!el.matches(messageBodySelector) && /^(inline|contents)/.test(stateOf(el).style.display)) el = el.parentElement;
      return el;
    };
    const walker = document.createTreeWalker(scope.nodeType === 1 ? scope : scope.parentElement,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let out = '';
    let block = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (range && !range.intersectsNode(node)) continue;
      const el = node.nodeType === 1 ? node : node.parentElement;
      if (!el?.closest(messageBodySelector)) continue;
      if (node.nodeType === 1) {
        if (node.localName === 'br') out += '\n';
        continue;
      }
      let value = node.data;
      if (node === range?.endContainer) value = value.slice(0, range.endOffset);
      if (node === range?.startContainer) value = value.slice(range.startOffset);
      if (!value.trim()) { out += ' '; continue; }
      if (!shown(node)) continue;
      const here = blockOf(el);
      if (block && here !== block) out += '\n';
      block = here;
      out += /^pre|break-spaces/.test(stateOf(el).style.whiteSpace) ? value : value.replace(/\s+/g, ' ');
    }
    return out.replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  };
  document.addEventListener('selectionchange', () => {
    const value = String(document.getSelection()?.toString() || '').trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      selectedAddress = { value: value.slice(0, 254), page: gmailLocation() };
  });
  // Trecho selecionado DENTRO de uma mensagem aberta; vazio se não houver. Só
  // a parte visível: a seleção também carregaria o texto escondido do meio.
  const messageSelection = () => {
    const selection = document.getSelection();
    const value = String(selection?.toString() || '').trim();
    const anchor = selection?.anchorNode;
    const element = anchor?.nodeType === 1 ? anchor : anchor?.parentElement;
    if (!value || !selection.rangeCount || !element?.closest?.(messageBodySelector)) return '';
    const range = selection.getRangeAt(0);
    return visibleText(range.commonAncestorContainer, range);
  };
  // A conta logada é o ÚLTIMO e-mail do título ("Assunto - voce@x.com - Gmail"):
  // com uma conversa aberta o assunto vem antes, e pode conter outro endereço
  // ("Proposta para ana@cliente.com") — o primeiro seria o do cliente.
  const accountEmail = () =>
    (document.title.match(/[^\s@]+@[^\s@]+\.[^\s@]+/g)?.at(-1) || '').toLowerCase();
  // Remetente de uma mensagem aberta (seletores internos do Gmail, como `.a3s`).
  const messageSender = (body) => {
    const sender = body.closest('.gs')?.querySelector('.gD[email]');
    return { email: String(sender?.getAttribute('email') || '').toLowerCase(), name: sender?.textContent?.trim() || '' };
  };
  // A recebida mais recente: numa thread em que a última mensagem é a SUA
  // resposta, traduzir "a última" traduzia o seu próprio texto. Sem como saber
  // o remetente, fica a última visível.
  const visibleMessageBodies = () => [...document.querySelectorAll(messageBodySelector)]
    .filter((node) => node.offsetWidth && node.offsetHeight);
  const describeMessage = (body) => ({ body, text: visibleText(body), from: messageSender(body).name });
  const lastOpenMessage = () => {
    const bodies = visibleMessageBodies();
    const me = accountEmail();
    const received = me ? bodies.filter((body) => messageSender(body).email !== me) : bodies;
    const body = received.at(-1) || bodies.at(-1);
    return body ? describeMessage(body) : null;
  };
  const request = (type, payload) => new Promise((resolve, reject) => {
    const handle = (reply) => {
      const runtimeError = globalThis.chrome?.runtime?.lastError;
      if (runtimeError || !reply?.ok) reject(new Error(reply?.error || runtimeError?.message || 'CRM indisponível.'));
      else resolve(reply.data);
    };
    if (typeof globalThis.adrGmailInvoke === 'function') {
      globalThis.adrGmailInvoke(type, payload).then(handle, reject);
    } else chrome.runtime.sendMessage({ type, ...payload }, handle);
  });
  $('toggle').addEventListener('click', () => {
    const open = !$('panel').classList.contains('open');
    $('panel').classList.toggle('open', open);
    $('toggle').setAttribute('aria-expanded', String(open));
    if (open) $('contact-email').focus();
  });
  $('selection').addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    const value = String(document.getSelection()?.toString() || '').trim() ||
      (selectedAddress?.page === gmailLocation() ? selectedAddress.value : '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return say('Selecione apenas um endereço de e-mail na mensagem.');
    $('contact-email').value = value.slice(0, 254);
    $('result').textContent = '';
    say('Endereço selecionado. Clique em Consultar CRM.');
  });
  $('open-crm').addEventListener('click', async (event) => {
    if (!event.isTrusted) return;
    try { await request('gmailOpenCrm', {}); say('CRM aberto.'); }
    catch (error) { say(error.message || 'Não foi possível abrir o CRM.'); }
  });
  $('lookup').addEventListener('click', async (event) => {
    if (!event.isTrusted || $('lookup').disabled) return;
    const email = $('contact-email').value.trim();
    const page = gmailLocation();
    $('lookup').disabled = true;
    $('result').textContent = '';
    say('Consultando contato...');
    try {
      const data = await request('gmailLookup', { email });
      if (email !== $('contact-email').value.trim() || page !== gmailLocation()) {
        say('A conta ou o endereço mudou. Consulte novamente.');
        return;
      }
      const lines = [...(data.contacts || []).map((contact) => `${contact.name || 'Contato'}${contact.company ? ` · ${contact.company}` : ''}`),
        ...(data.deals || []).map((deal) => `Negócio com contato principal ${deal.number || ''}: ${deal.title || 'Sem título'} (${deal.status || 'estado indisponível'})`)];
      if (data.dealsUnavailable) lines.push('Negócios indisponíveis para sua permissão no CRM.');
      $('result').textContent = lines.length ? lines.join('\n') : 'Nenhum contato ou negócio encontrado para este endereço.';
      say('Consulta concluída.');
    } catch (error) { say(error.message || 'Consulta indisponível.'); }
    finally { $('lookup').disabled = false; }
  });
  // Mensagem (corpo `.a3s`) da última tradução, para o "Traduzir mensagem anterior".
  // Guarda também o começo do texto: ao expandir o histórico ou atualizar a
  // conversa, o Gmail recria os nós e a referência ao elemento se perde.
  let translatedMessage = null;
  const translatedIndex = (bodies) => {
    if (translatedMessage?.page !== gmailLocation()) return -1;
    const direct = bodies.indexOf(translatedMessage.body);
    if (direct >= 0) return direct;
    // Mensagens com o mesmo começo ("Obrigado!" duas vezes): entre as que batem,
    // a mais perto da posição onde a tradução foi feita.
    let best = -1;
    bodies.forEach((body, index) => {
      if (visibleText(body).slice(0, 200) !== translatedMessage.text) return;
      if (best < 0 || Math.abs(index - translatedMessage.index) < Math.abs(best - translatedMessage.index)) best = index;
    });
    return best;
  };
  const translateButtons = ['translate-open', 'translate-prev'];
  // `body` null = trecho selecionado: aí não há "mensagem anterior" a oferecer.
  const translate = async (full, source, body) => {
    const text = full.slice(0, 6000);
    const page = gmailLocation();
    for (const id of translateButtons) $(id).disabled = true;
    $('translation').hidden = true;
    $('copy-translation').hidden = true;
    // Só volta a aparecer com uma tradução bem-sucedida: depois de uma falha, o
    // "anterior" apontaria para a mensagem de antes da falha, não a da tela.
    $('translate-prev').hidden = true;
    translatedMessage = null;
    say('Traduzindo e-mail...');
    try {
      const data = await request('gmailTranslate', { text });
      if (page !== gmailLocation()) return say('Você mudou de e-mail. Traduza novamente.');
      if (!data?.translatedText) return say('Não veio tradução. O texto pode já estar em português.');
      $('translation').value = data.translatedText;
      $('translation').hidden = false;
      $('copy-translation').hidden = false;
      translatedMessage = body
        ? { page, body, text: full.trim().slice(0, 200), index: visibleMessageBodies().indexOf(body) }
        : null;
      $('translate-prev').hidden = !body;
      // Diz DE ONDE veio o texto: com várias mensagens na thread, o usuário confere
      // na hora se é a que ele queria.
      say(full.length > text.length
        ? `Tradução ${source} pronta. Era longo: só os primeiros 6.000 caracteres foram traduzidos.`
        : `Tradução ${source} pronta.`);
    } catch (error) { say(error.message || 'Não foi possível traduzir o e-mail.'); }
    finally { for (const id of translateButtons) $(id).disabled = false; }
  };
  // O clique no botão pode limpar a seleção da página antes do `click`; o
  // pointerdown chega antes disso. Pelo teclado (Tab + Enter) a seleção continua
  // intacta e é lida no próprio clique. Só vale para o clique que se segue: se o
  // ponteiro sai do botão ou o gesto é cancelado, não há click, e o trecho não
  // pode sobrar para a próxima ativação pelo teclado (talvez já em outro e-mail).
  let selectionAtPress = null;
  const dropPressedSelection = () => { selectionAtPress = null; };
  $('translate-open').addEventListener('pointerdown', () => {
    selectionAtPress = { value: messageSelection(), page: gmailLocation() };
  });
  $('translate-open').addEventListener('pointerleave', dropPressedSelection);
  $('translate-open').addEventListener('pointercancel', dropPressedSelection);
  $('translate-open').addEventListener('click', async (event) => {
    if (!event.isTrusted || $('translate-open').disabled) return;
    const pressed = selectionAtPress?.page === gmailLocation() ? selectionAtPress.value : '';
    dropPressedSelection();
    const selected = pressed || messageSelection();
    if (selected) return translate(selected, 'do trecho selecionado', null);
    const message = lastOpenMessage();
    if (!message?.text) return say('Abra um e-mail recebido para traduzir.');
    return translate(message.text, message.from ? `da mensagem de ${message.from}` : 'do e-mail', message.body);
  });
  // "Qual é a minha mensagem" é palpite (remetente = conta do título). Quem
  // responde por um alias ("Enviar como") tem a própria resposta tomada como
  // recebida — o status mostra de quem é, e daqui o usuário recua uma mensagem
  // por clique em vez de selecionar o texto à mão.
  $('translate-prev').addEventListener('click', (event) => {
    if (!event.isTrusted || $('translate-prev').disabled) return;
    const bodies = visibleMessageBodies();
    const index = translatedIndex(bodies);
    const previous = index > 0 ? describeMessage(bodies[index - 1]) : null;
    if (!previous?.text) return say('Não há mensagem anterior aberta nesta conversa.');
    return translate(previous.text, previous.from ? `da mensagem de ${previous.from}` : 'da mensagem anterior', previous.body);
  });
  $('copy-translation').addEventListener('click', async (event) => {
    if (!event.isTrusted) return;
    try { await navigator.clipboard.writeText($('translation').value); say('Tradução copiada.'); }
    catch { $('translation').focus(); $('translation').select(); say('Selecione a tradução e copie com Ctrl+C.'); }
  });
  $('read').addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    const visible = [...document.querySelectorAll(composerSelector)]
      .filter((node) => node.offsetWidth && node.offsetHeight && isComposer(node));
    const editor = visible.includes(lastComposer) ? lastComposer : visible.length === 1 ? visible[0] : null;
    if (!editor) return say(visible.length > 1 ? 'Clique no rascunho desejado e tente novamente.' : 'Abra um rascunho do Gmail para usar seu texto.');
    $('source').value = (editor.innerText || '').slice(0, 6000);
    const subject = editor.closest('[role="dialog"]')?.querySelector('[name="subjectbox"]');
    // Sem assunto neste rascunho, limpa: o de um rascunho anterior não vale aqui.
    $('subject').value = String(subject?.value || '').slice(0, 200);
    $('mode').value = 'rewrite';
    clearPreview();
    say('Texto carregado para revisão. Confira antes de gerar.');
  });
  $('generate').addEventListener('click', async (event) => {
    if (!event.isTrusted || $('generate').disabled) return;
    const input = {
      mode: $('mode').value, language: $('language').value, tone: $('tone').value,
      subject: $('subject').value, instructions: $('instructions').value, text: $('source').value,
    };
    const page = gmailLocation();
    $('generate').disabled = true;
    clearPreview();
    say('Preparando prévia...');
    try {
      const result = await request('gmailAssist', input);
      if (page !== gmailLocation() || input.mode !== $('mode').value ||
          input.language !== $('language').value || input.tone !== $('tone').value ||
          input.subject !== $('subject').value || input.instructions !== $('instructions').value ||
          input.text !== $('source').value) {
        say('A conta ou o texto mudou. Prepare uma nova prévia.');
        return;
      }
      $('preview').value = result.body || '';
      // value por script ignora o maxlength; acima de 200 o próximo pedido reprovaria.
      if (result.subject) $('subject').value = String(result.subject).slice(0, 200);
      $('copy').disabled = !$('preview').value;
      $('copy-subject').disabled = !$('subject').value;
      say('Prévia pronta. Revise e copie o texto para o Gmail.');
    } catch (error) { say(error.message || 'Não foi possível criar a prévia.'); }
    finally { $('generate').disabled = false; }
  });
  $('copy').addEventListener('click', async (event) => {
    if (!event.isTrusted || $('copy').disabled) return;
    try { await navigator.clipboard.writeText($('preview').value); say('Texto copiado. Cole no rascunho do Gmail.'); }
    catch { $('preview').focus(); $('preview').select(); say('Selecione o texto e copie com Ctrl+C.'); }
  });
  $('copy-subject').addEventListener('click', async (event) => {
    if (!event.isTrusted || $('copy-subject').disabled) return;
    try { await navigator.clipboard.writeText($('subject').value); say('Assunto copiado. Cole no Gmail.'); }
    catch { $('subject').focus(); $('subject').select(); say('Copie o assunto com Ctrl+C.'); }
  });
  // Trocar de conversa descarta o que era da anterior (tradução, consulta,
  // seleções): senão "Copiar tradução" copiava a de outro e-mail.
  let shownPage = gmailLocation();
  window.addEventListener('hashchange', () => {
    if (gmailLocation() === shownPage) return;
    shownPage = gmailLocation();
    selectedAddress = null;
    dropPressedSelection();
    translatedMessage = null;
    $('translation').value = '';
    for (const id of ['translation', 'copy-translation', 'translate-prev']) $(id).hidden = true;
    $('result').textContent = '';
    say('');
  });
  document.documentElement.appendChild(host);
})();
