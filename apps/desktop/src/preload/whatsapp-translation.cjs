/* global window, document, location, MutationObserver, addEventListener, innerHeight, CSSStyleSheet */
(() => {
  if (window !== window.top || location.origin !== 'https://web.whatsapp.com') return;
  const {ipcRenderer} = require('electron');
  const D = window.CRMWADom, same = window.CRMWAUtils.isSameComposerText;
  let prefs, epoch = 0, busy = false, dispatching = false, running = false, dirty = false, timer;
  const seen = new WeakMap();
  const cache = new Map();
  let readVersion = 0;
  let panel, buttons = [], notice, current, signature, reading = false, saving = false, checkedAt = 0;
  let trigger, choices, compactSlot, reviewToggle, pendingReview;
  const languages = [
    ['off','PT','Português','Enviar o texto como você escreveu'],
    ['en','EN','Inglês corporativo','Traduzir do português para inglês corporativo ao enviar'],
    ['es','ES','Espanhol','Traduzir do português para espanhol ao enviar'],
  ];
  function showChoices(open, focusTrigger = false) {
    choices.hidden = !open;
    trigger.setAttribute('aria-expanded',String(open));
    if (open) (buttons.find(b=>b.value===current?.language) || buttons[0]).focus();
    else if (focusTrigger) trigger.focus();
  }
  addEventListener('pointerdown',event=>{
    if (choices && !choices.hidden && !event.composedPath().includes(panel)) showChoices(false);
  },true);
  const chatContext = () => ipcRenderer.invoke('bira:translation-chat');
  function snapshot() {
    return [D.footer(), D.mainComposer(), document.querySelector('#main header'), D.headerTitle(),
      document.querySelector('#pane-side [aria-selected="true"]')];
  }
  function matches(a,b) { return !!a && !!b && a.every((value,i)=>value===b[i]); }
  function status(message='') {
    if (notice && notice.textContent !== message) notice.textContent = message;
  }

  let contactHost, contactKey, openingContact=false;
  function updateContact(header, chat) {
    if (!header || !chat?.individual) {
      contactHost?.remove();contactHost=null;contactKey=null;return;
    }
    contactKey=chat.key;
    if (contactHost?.parentElement===header) return;
    contactHost?.remove();
    header.querySelector(':scope > [data-bira-google-contact]')?.remove();
    const host=document.createElement('div');
    host.dataset.biraGoogleContact='';
    host.style.cssText='display:inline-flex;align-self:center;flex:none;margin-inline:3px';
    const root=host.attachShadow({mode:'open'});
    const style=new CSSStyleSheet();
    style.replaceSync(`
      button{display:inline-flex;align-items:center;gap:5px;min-height:32px;padding:3px 7px;border:0;border-radius:8px;background:transparent;color:var(--secondary,CanvasText);font:500 12px system-ui;cursor:pointer}
      button:hover,button:focus-visible{background:color-mix(in srgb,currentColor 10%,transparent)}
      button:focus-visible{outline:2px solid currentColor}button:disabled{opacity:.65}button>*{pointer-events:none}
      @media(max-width:720px){span{display:none}}
    `);
    root.adoptedStyleSheets=[style];
    const button=document.createElement('button');
    button.type='button';button.title='Salvar no Google';button.setAttribute('aria-label',button.title);
    button.innerHTML='<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="9" cy="8" r="3.4"/><path d="M2.5 20c.4-3.5 2.8-5.7 6.5-5.7 2.2 0 4.1.8 5.2 2.2M18 7v7m-3.5-3.5h7"/></svg><span>Salvar no Google</span>';
    root.append(button);
    const title=header.querySelector('span[title],span[dir="auto"]');
    let branch=title;
    while(branch && branch.parentElement!==header) branch=branch.parentElement;
    if(branch)branch.after(host);else header.append(host);
    contactHost=host;
    button.addEventListener('click',async event=>{
      event.stopPropagation();
      if (!event.isTrusted || openingContact || !contactKey || !matches(signature,snapshot())) return;
      const key=contactKey;
      openingContact=true;button.disabled=true;
      try {
        if (!await ipcRenderer.invoke('bira:open-google-contact',key)) throw Error();
      } catch {
        if(contactKey===key && host.isConnected){
          button.title='Telefone indisponível ou conversa alterada. Tente novamente.';
          button.querySelector('span').textContent='Confira a conversa';
          setTimeout(()=>{button.title='Salvar no Google';button.querySelector('span').textContent=button.title;},3000);
        }
      } finally {openingContact=false;button.disabled=false;}
    });
  }

  function composerSlot(footer, composer) {
    if (!footer?.contains(composer)) return null;
    for (let item=composer; item && item!==footer; item=item.parentElement) {
      const row=item.parentElement;
      const style=window.getComputedStyle(row);
      if (row.children.length>1 && style.display.includes('flex') && style.flexDirection.startsWith('row')) return item;
    }
    // O rodapé compacto também pode usar grid ou blocos em vez de uma linha flex.
    return composer.parentElement?.closest('[data-testid="conversation-compose-box-input"]') || composer;
  }

  function mount(slot) {
    if (panel?.isConnected && (panel.previousElementSibling === slot || compactSlot===slot)) return;
    pendingReview?.cancel();
    panel?.remove();
    panel = document.createElement('div');
    panel.dataset.biraChatControls = '';
    panel.style.cssText = 'display:inline-flex;position:relative;align-self:center;z-index:2;flex:none';
    const root = panel.attachShadow({mode:'open'});
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      :host { color-scheme:light dark; font: 500 13px/1.3 system-ui,sans-serif }
      .control { display:inline-flex; align-items:center; color:var(--primary,CanvasText) }
      .picker { position:relative; flex:none }
      .trigger { display:flex; align-items:center; gap:4px; min-height:28px; padding:2px 5px; font-size:11px;
        color:var(--secondary,inherit) }
      .trigger::after { content:''; width:5px; height:5px; border:solid currentColor;
        border-width:0 1px 1px 0; transform:translateY(-1px) rotate(45deg) }
      .group { position:absolute; inset-inline-end:0; bottom:calc(100% + 3px); min-width:132px;
        padding:4px; border:1px solid color-mix(in srgb,currentColor 20%,transparent); border-radius:10px;
        background:var(--dropdown-background,Canvas); box-shadow:0 3px 12px #0002 }
      .group button { display:block; width:100%; text-align:start }
      .review-option {border-top:1px solid color-mix(in srgb,currentColor 18%,transparent)}
      .review-option[aria-checked=true]::before {content:'✓ '}
      .review {position:absolute;inset-inline-end:0;bottom:calc(100% + 6px);width:min(320px,65vw);
        box-sizing:border-box;padding:12px;border-radius:10px;background:var(--dropdown-background,Canvas);
        border:1px solid color-mix(in srgb,currentColor 20%,transparent);box-shadow:0 3px 12px #0002}
      .review textarea {display:block;width:100%;box-sizing:border-box;margin:8px 0;padding:6px;
        font:inherit;color:inherit;background:var(--compose-input-background,Canvas);resize:vertical}
      .review button:last-child {background:#116951;color:white}
      .control:has(.review) [role=status] {display:none}
      button { appearance:none; box-sizing:border-box; cursor:pointer; min-height:30px; padding:4px 10px;
        border:1px solid transparent; border-radius:9px; color:inherit; background:transparent; font:inherit }
      button:hover:enabled { background:color-mix(in srgb,currentColor 12%,transparent) }
      button[aria-pressed=true], button[aria-pressed=true]:hover { color:white; background:#116951; font-weight:650 }
      button[aria-pressed=true]::after { content:'✓'; float:inline-end }
      button:focus-visible { outline:2px solid var(--primary,currentColor); outline-offset:1px }
      button:disabled { cursor:default; opacity:.65 }
      [role=status] { position:absolute; inset-inline-end:0; bottom:calc(100% + 4px); width:max-content;
        max-width:min(240px,50vw); padding:4px 8px; border-radius:6px; background:var(--dropdown-background,Canvas) }
      [role=status]:empty, .control:has(.group:not([hidden])) [role=status] { display:none }
      @media(forced-colors:active){button[aria-pressed=true]{border-color:Highlight}}
    `);
    root.adoptedStyleSheets = [sheet];
    const control=document.createElement('div');control.className='control';
    const picker=document.createElement('div');picker.className='picker';
    trigger=document.createElement('button');trigger.className='trigger';trigger.type='button';
    trigger.disabled=true;trigger.textContent='Idioma';trigger.setAttribute('aria-expanded','false');
    trigger.setAttribute('aria-controls','language-choices');
    choices=document.createElement('div');choices.className='group';choices.id='language-choices';
    choices.hidden=true;choices.setAttribute('role','group');choices.setAttribute('aria-label','Idioma de envio');
    trigger.addEventListener('click',()=>showChoices(choices.hidden));
    picker.addEventListener('keydown',event=>{
      if (event.key==='Escape' && !choices.hidden) {
        event.preventDefault();event.stopPropagation();showChoices(false,true);
      }
    });
    picker.addEventListener('focusout',event=>{
      if (!picker.contains(event.relatedTarget)) showChoices(false);
    });
    buttons=[];
    for(const [value,,name,hint] of languages) {
      const button=document.createElement('button');
      button.type='button';button.textContent=name;button.title=hint;button.value=value;
      button.setAttribute('aria-pressed','false');button.disabled=true;
      button.addEventListener('click',changeLanguage);
      buttons.push(button);choices.append(button);
    }
    const glossary=document.createElement('button');
    glossary.type='button';glossary.textContent='Glossário de inglês…';
    glossary.addEventListener('click',async event=>{
      if (!event.isTrusted) return;
      event.stopPropagation();showChoices(false);
      try {await ipcRenderer.invoke('bira:open-glossary');} catch {status('Abra o glossário em Configurações → Tradução.');}
    });
    reviewToggle=document.createElement('button');
    reviewToggle.type='button';reviewToggle.className='review-option';
    reviewToggle.setAttribute('role','checkbox');reviewToggle.textContent='Revisar antes de enviar';
    reviewToggle.addEventListener('click',changeLanguage);
    choices.append(reviewToggle,glossary);
    notice=document.createElement('span');notice.dataset.biraSendStatus='';notice.setAttribute('role','status');
    picker.append(trigger,choices);control.append(notice,picker);root.append(control);
    const rowStyle=window.getComputedStyle(slot.parentElement);
    if (!rowStyle.display.includes('flex') && !rowStyle.display.includes('grid')) {
      const footer=slot.closest('footer');
      let rules=document.getElementById('bira-compact-picker-style');
      if (!rules) {
        rules=document.createElement('style');
        rules.id='bira-compact-picker-style';
        rules.textContent='footer:has(> [data-bira-compact][data-bira-static-footer]){position:relative}';
        document.head.append(rules);
      }
      panel.dataset.biraCompact='';
      if (window.getComputedStyle(footer).position==='static') panel.dataset.biraStaticFooter='';
      panel.style.position='absolute';panel.style.insetInlineEnd='4px';panel.style.bottom='100%';
      footer.append(panel);
      compactSlot=slot;
    } else {
      compactSlot=null;
      slot.after(panel);
    }
    signature = undefined;
  }

  function renderChoice() {
    if (!panel?.isConnected) return;
    panel.setAttribute('aria-busy',String(saving || busy));
    const language=languages.find(([value])=>value===current?.language);
    trigger.textContent=language?.[1] || 'Idioma';
    trigger.title=language ? 'Idioma de envio desta conversa: '+language[2] : 'Idioma de envio desta conversa';
    trigger.setAttribute('aria-label',trigger.title);
    trigger.disabled=!current || saving || busy;
    reviewToggle.disabled=trigger.disabled || current?.language==='off';
    reviewToggle.setAttribute('aria-checked',String(current?.review===true));
    if (trigger.disabled) showChoices(false);
    for (const button of buttons) {
      button.disabled = !current || saving;
      button.setAttribute('aria-pressed',String(button.value===current?.language));
    }
  }

  async function changeLanguage(event) {
    event.stopPropagation();
    if (!event.isTrusted || saving || busy || !current) return;
    const toggling=event.currentTarget===reviewToggle;
    const expected=current.key, target=toggling ? current.language : event.currentTarget.value;
    const review=toggling ? !current.review : undefined;
    showChoices(false,true);
    if (!toggling && current.language===target) return;
    // A lookup started before this click must not overwrite the saved choice.
    readVersion++;
    saving=true;renderChoice();status('Salvando…');
    try {
      const saved=await ipcRenderer.invoke('bira:set-chat-language',expected,target,review);
      if (!saved || saved.key!==expected || saved.language!==target || (toggling && saved.review!==review)) throw Error();
      prefs.hasTranslatedChats=saved.hasTranslatedChats;
      if (current?.key===expected && matches(signature,snapshot())) {
        current={...current,...saved};status();
      }
    } catch { status('Não foi possível salvar. Confira a conversa e tente novamente.'); }
    finally {saving=false;renderChoice();checkedAt=0;schedule();}
  }

  async function syncControl() {
    if (pendingReview && !pendingReview.valid()) pendingReview.cancel();
    if (document.hidden) return;
    const next=snapshot(), slot=composerSlot(next[0],next[1]);
    if (!slot) panel?.remove();else mount(slot);
    if (!next[2]) {updateContact(null,null);current=null;signature=undefined;return;}
    if (!matches(signature,next)) {
      signature=next;current=null;updateContact(null,null);renderChoice();checkedAt=0;status('Identificando conversa…');
    }
    if (reading || saving || performance.now()-checkedAt<15000 && checkedAt!==0) return;
    const version=readVersion;
    reading=true;checkedAt=performance.now();
    try {
      const chat=await chatContext();
      if (version!==readVersion || saving || !matches(next,snapshot())) {checkedAt=0;return;}
      if (current?.key !== chat?.key || current?.language !== chat?.language || !current) {
        status(chat?'':'Aguardando conversa…');
      }
      current=chat;
      if (pendingReview && !pendingReview.valid()) pendingReview.cancel();
      updateContact(next[2],current);renderChoice();
    } catch {
      if (version===readVersion) {current=null;updateContact(null,null);renderChoice();status('Aguardando conversa…');}
    }
    finally {reading=false;}
  }

  function schedule() {
    if (!prefs || timer) return;
    timer = setTimeout(() => { timer = null; void scan(); }, 160);
  }
  async function scan() {
    void syncControl();
    if (!prefs.incoming || document.hidden) return;
    if (running) { dirty = true; return; }
    running = true;
    const version = epoch;
    try {
      for (const row of D.visibleIncomingBubbles().reverse()) {
        if (epoch !== version || !prefs.incoming || document.hidden) break;
        const box = D.primaryDataIdEl(row);
        if (!box?.isConnected) continue;
        const {top,bottom} = box.getBoundingClientRect();
        if (bottom <= 0 || top >= innerHeight) continue;
        const text = D.bubbleText(row);
        const previous = seen.get(box);
        if (previous?.id === box.dataset.id && previous.text === text && previous.epoch === epoch &&
            (!previous.tag || previous.tag.isConnected)) continue;
        previous?.tag?.remove();
        const current = {id:box.dataset.id,text,epoch};
        seen.set(box,current);
        if (!text || text.length > 6000) continue;
        let answer = cache.get(text);
        if (!answer) {
          answer = await ipcRenderer.invoke('bira:translate-text',text,'pt').catch(() => ({error:true}));
          if (epoch !== version) break;
          if (answer?.text) {
            cache.set(text,answer);
            if (cache.size>150) cache.delete(cache.keys().next().value);
          }
        }
        if (!box.isConnected || box.dataset.id !== current.id || D.bubbleText(row) !== text || answer?.unchanged) continue;
        const tag = document.createElement('div');
        current.tag = tag;
        tag.dataset.biraTranslation = '';
        tag.style.cssText='margin:4px 8px;padding-inline-start:8px;border-inline-start:2px solid currentColor;font-size:13px;white-space:pre-wrap';
        if (answer?.text) {
          const label = document.createElement('strong');
          label.textContent = 'Tradução';
          tag.append(label,document.createElement('br'),document.createTextNode(answer.text));
        } else {
          const retry = document.createElement('button');
          retry.textContent='Tradução indisponível · Tentar novamente';
          retry.onclick = e => { e.stopPropagation(); seen.delete(box);tag.remove();schedule(); };
          tag.append(retry);
        }
        box.append(tag);
      }
    } finally { running=false;if(dirty){dirty=false;schedule();} }
  }

  function offerOriginal(el, original, selection, captured) {
    status('Mensagem com menção. ');
    const button=document.createElement('button');
    button.type='button';button.textContent='Enviar original desta vez';notice.append(button);
    button.addEventListener('click',async event=>{
      if (!event.isTrusted || button.disabled || busy) return;
      event.stopPropagation();button.disabled=true;busy=true;
      try {
        const chat=await chatContext();
        if (!chat || chat.key!==selection.key || chat.language!==selection.language || !matches(captured,snapshot()) || el!==D.composer() || !same(D.composerReadText(el),original) || !D.composerHasStructuredContent(el)) throw Error();
        dispatching=true;
        if (!D.clickSend()) throw Error();
        status();
      } catch {status('Confira a conversa e tente novamente.');}
      finally {dispatching=false;busy=false;}
    });
  }

  function reviewTranslation(text, valid, el, language) {
    return new Promise(resolve=>{
      const box=document.createElement('div');
      box.className='review';box.setAttribute('role','dialog');
      const label=document.createElement('label');
      label.textContent=language==='en'?'Prévia em inglês':'Prévia em espanhol';
      box.setAttribute('aria-label',label.textContent);
      const field=document.createElement('textarea');field.rows=3;field.value=text;
      label.append(field);
      const cancel=document.createElement('button'), send=document.createElement('button');
      cancel.type=send.type='button';cancel.textContent='Cancelar';send.textContent='Enviar tradução';
      const finish=value=>{
        box.remove();pendingReview=null;
        if (valid()) el.focus();
        resolve(value);
      };
      pendingReview={valid,cancel:()=>finish(null)};
      field.addEventListener('input',()=>{send.disabled=!field.value.trim();});
      cancel.onclick=()=>finish(null);
      send.onclick=event=>{if(event.isTrusted && field.value.trim()) finish(valid()?field.value:null);};
      box.addEventListener('keydown',event=>{
        event.stopPropagation();
        if(event.key==='Escape'){event.preventDefault();finish(null);}
      });
      box.append(label,cancel,send);panel.shadowRoot.querySelector('.control').append(box);
      field.focus();
    });
  }

  async function sendFromChat(el, original) {
    const captured=snapshot(), selection=current;
    const sameView = () => matches(captured,snapshot()) && el === D.composer() && el.isConnected &&
      !document.hidden && !saving && current?.key === selection?.key && current?.language === selection?.language &&
      current?.review === selection?.review;
    const unchanged = () => sameView() && same(D.composerReadText(el),original);
    const chat=await chatContext();
    if (!chat || !selection || chat.key!==selection.key || chat.language!==selection.language || chat.review!==selection.review || !unchanged())
      throw Error('A conversa ou o idioma mudou. Confira e envie novamente.');
    let text = original;
    let attemptedPaste=false;
    try {
    if (chat.language !== 'off') {
      if (D.composerHasStructuredContent(el)) {offerOriginal(el,original,selection,captured);return false;}
      status('Traduzindo…');
      const result=await ipcRenderer.invoke('bira:translate-text',original,chat.language,chat.key);
      if (!result?.text || result.error) throw Error('A tradução falhou.');
      const confirmed=await chatContext();
      if (!unchanged() || confirmed?.key!==chat.key || confirmed.language!==chat.language || confirmed.review!==chat.review)
        throw Error('A conversa, o idioma ou o rascunho mudou.');
      text=result.text;
      if (chat.review) {
        status();
        text=await reviewTranslation(text,unchanged,el,chat.language);
        if (text===null) return false;
        const latest=await chatContext();
        if (!unchanged() || latest?.key!==chat.key || latest.language!==chat.language || !latest.review)
          throw Error('A conversa, o idioma ou o rascunho mudou.');
      }
      attemptedPaste=!same(original,text);
      if (attemptedPaste && !await D.composerPasteAll(el,text,() => sameView() &&
          (same(D.composerReadText(el),original) || same(D.composerReadText(el),text)))) throw Error('Confira o rascunho.');
      const final=await chatContext();
      if (final?.key!==chat.key || final.language!==chat.language || final.review!==chat.review) throw Error('A conversa ou o idioma mudou.');
    }
    if (!sameView() || !same(D.composerReadText(el),text)) throw Error('Confira o rascunho.');
    dispatching=true;
    try { if (!D.clickSend()) throw Error('Botão Enviar indisponível.'); }
    finally {dispatching=false;}
    return true;
    } catch (error) {
      const stillTranslated=()=>sameView() && same(D.composerReadText(el),text);
      if (attemptedPaste && stillTranslated() && (await chatContext().catch(()=>null))?.key===selection.key && stillTranslated())
        await D.composerPasteAll(el,original,()=>sameView() && (same(D.composerReadText(el),text)||same(D.composerReadText(el),original)));
      throw error;
    }
  }
  function intercept(event, keyboard) {
    if (dispatching || (prefs && !prefs.hasTranslatedChats && !saving)) return;
    if (keyboard) {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || !D.isComposer(event.target) || D.isSuggestionOpen()) return;
    } else {
      const btn = D.sendButton();
      if (!btn || !btn.contains(event.target)) return;
    }
    const el = D.composer(), original = el && D.composerReadText(el);
    if (!original?.trim()) return;
    event.preventDefault();event.stopImmediatePropagation();
    if (!prefs) {
      const next=snapshot(), slot=composerSlot(next[0],next[1]);
      if (slot) {mount(slot);status('Carregando idioma. Clique em enviar quando estiver pronto.');}
      void readPreferences();return;
    }
    if (!event.isTrusted || busy || saving) return;
    busy=true;renderChoice();
    sendFromChat(el,original)
      .then(sent => {if(sent)status();})
      .catch(error => {checkedAt=0;status('Envio interrompido. ' + (error.message || 'Confira o rascunho.'));})
      .finally(() => {busy=false;renderChoice();schedule();});
  }
  document.addEventListener('keydown',e=>intercept(e,true),true);
  document.addEventListener('click',e=>intercept(e,false),true);
  function configure(value) {
    epoch++;prefs=value;cache.clear();
    document.querySelectorAll('[data-bira-translation]').forEach(el=>el.remove());
    schedule();
  }
  ipcRenderer.on('bira:translation-settings',(_e,value)=>configure(value));
  ipcRenderer.on('bira:privacy-mode',(_e,mode)=>{if(mode==='presentation')pendingReview?.cancel();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden) pendingReview?.cancel();});
  addEventListener('pagehide',()=>pendingReview?.cancel(),{once:true});
  let loading=false, retry, disposed=false;
  async function readPreferences() {
    if (prefs || loading || disposed) return;
    loading=true;const version=epoch;
    const initial=await ipcRenderer.invoke('bira:translation-settings').catch(()=>null);
    loading=false;
    if (disposed) return;
    if (epoch===version && initial) configure(initial);
    if (!prefs) {clearTimeout(retry);retry=setTimeout(readPreferences,1000);}
  }
  async function init() {
    void readPreferences();
    const observer=new MutationObserver(schedule);
    observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-id']});
    document.addEventListener('scroll',schedule,true);
    document.addEventListener('visibilitychange',schedule);
    // The chat list can recycle a selected row between contacts with identical names.
    const heartbeat=setInterval(()=>{ if (!document.hidden) {checkedAt=0;void syncControl();} },15000);
    addEventListener('pagehide',()=>{disposed=true;epoch++;observer.disconnect();clearTimeout(retry);clearTimeout(timer);clearInterval(heartbeat);},{once:true});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else void init();
})();
