(() => {
  const api=window.adrShell;
  const css=document.createElement('style');css.textContent=`
  #bira-privacy-ui[hidden]{display:none!important}
  #bira-privacy-ui{position:fixed;inset:0;z-index:20;display:grid;place-items:center;background:var(--bg,#101827);color:var(--fg,#edf3fa);font:14px/1.5 var(--adr-font,sans-serif);padding:24px;box-sizing:border-box;overflow:auto}
  #bira-privacy-ui .privacy-card{width:min(460px,100%);padding:28px;border:1px solid var(--line2,#405066);border-radius:16px;background:var(--bar,#182332);box-sizing:border-box}
  #bira-privacy-ui h2{font-size:22px;margin:0 0 8px} #bira-privacy-ui p{opacity:.8;margin:8px 0 20px}
  #bira-privacy-ui label{display:flex;align-items:center;gap:12px;padding:9px 0;cursor:pointer}
  #bira-privacy-ui input{width:18px;height:18px;accent-color:#68b3ff}
  #bira-privacy-ui select{width:100%;padding:10px;border-radius:8px;background:var(--bg,#101827);color:inherit;border:1px solid var(--line2,#405066);margin:8px 0}
  #bira-privacy-ui button{padding:10px 16px;border:1px solid var(--line2,#405066);border-radius:8px;background:var(--bg,#101827);color:inherit;cursor:pointer;font:inherit}
  #bira-privacy-ui .privacy-primary{background:#2563a8;color:white;border-color:#2563a8}
  #bira-privacy-ui .privacy-actions{display:flex;gap:12px;margin-top:20px;flex-wrap:wrap}
  #bira-privacy-ui fieldset{border:0;padding:10px 0;margin:0} #bira-privacy-ui legend{font-weight:600}
  #bira-privacy-ui :focus-visible{outline:2px solid #68b3ff;outline-offset:3px}
  `;document.head.append(css);
  const root=document.createElement('section');root.id='bira-privacy-ui';root.hidden=true;document.body.append(root);
  let state={},selected='',signature='';
  const defaults={names:false,avatars:false,previews:true,messages:false,media:true,reveal:'hover'};
  let feedback='';
  async function apply(service,action) {
    try {
      const result=await action();
      if (!result?.ok) throw Error();
      feedback='';
    } catch {feedback='Não foi possível salvar a preferência de '+service.name+'. Confira o disco e tente novamente.';}
    state=await api.getState();signature='';render();
  }
  function render(){
    const next=JSON.stringify([state.privacyPanelOpen,state.privacyCovered,state.privacyGroup,state.activeSurface,state.services,state.whatsappPrivacyModes,state.whatsappPrivacyOptions,state.whatsappTranscription,state.whatsappTranslation,state.whatsappAudioLanguages]);
    if(next===signature)return;signature=next;
    const wasOpen=!root.hidden; const focusedId=document.activeElement?.id;
    root.hidden=!(state.privacyPanelOpen||state.privacyCovered);if(root.hidden)return;
    const services=(state.services||[]).filter(s=>s.kind==='whatsapp');
    const active=services.find(s=>'service:'+s.id===state.activeSurface);
    if(!services.some(s=>s.id===selected))selected=active?.id||services[0]?.id||'';
    const service=services.find(s=>s.id===selected);
    const mode=state.whatsappPrivacyModes?.[selected]||'normal';
    const opts={...defaults,...state.whatsappPrivacyOptions?.[selected]};
    root.innerHTML='<div class="privacy-card"></div>';const card=root.firstChild;
    const title=document.createElement('h2');card.append(title);
    const description=document.createElement('p');card.append(description);
    if(!state.privacyPanelOpen){
      const hidden=state.whatsappPrivacyModes?.[active?.id]==='presentation';
      title.textContent=hidden?'WhatsApp oculto':'Conteúdo protegido';
      description.textContent=hidden?'As sessões continuam conectadas, com áudio e notificações silenciados. Ao voltar, suas preferências serão restauradas.':'A página ainda não foi reconhecida. Aguarde o carregamento ou desligue o desfoque para visualizar.';
      const back=document.createElement('button');back.id='privacy-return';back.className='privacy-primary';back.textContent=hidden?'Voltar às conversas':'Desligar desfoque';
      const group=state.privacyGroup||[];
      if (hidden && !group.includes(active?.id)) back.textContent='Reexibir esta sessão';
      back.onclick=()=>hidden?api.restorePrivacy(group.includes(active?.id)?undefined:active.id):api.setPrivacy(active.id,'normal');
      card.append(back);
      if(hidden && group.length && !group.includes(active?.id)){
        const restore=document.createElement('button');restore.textContent='Restaurar as sessões ocultadas em grupo';
        restore.onclick=()=>api.restorePrivacy();card.append(restore);
      }
      if(!wasOpen)back.focus();return;
    }
    title.textContent='Privacidade do WhatsApp';description.textContent='Escolha o que desfocar. O PIN continua controlando o acesso separadamente.';
    const select=document.createElement('select');select.id='privacy-session';select.setAttribute('aria-label','Sessão do WhatsApp');
    for(const s of services){const option=document.createElement('option');option.value=s.id;option.textContent=s.name;option.selected=s.id===selected;select.append(option);}card.append(select);
    select.onchange=()=>{selected=select.value;signature='';render();};
    function toggle(label,key,checked,onchange){const row=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.id='privacy-'+key;input.checked=checked;input.onchange=()=>{input.disabled=true;void apply(service,()=>onchange(input.checked));};row.append(input,document.createTextNode(label));card.append(row);}
    if(service){
      toggle('Transcrever áudios automaticamente neste PC','transcription',!!state.whatsappTranscription?.[selected],v=>api.setTranscription(selected,v));
      const spoken=document.createElement('label');spoken.textContent='Idioma dos áudios';
      const audio=document.createElement('select');audio.id='audio-language';
      for (const [value,name] of [['pt','Português'],['auto','Automático'],['en','Inglês'],['es','Espanhol']]) audio.add(new Option(name,value));
      audio.value=state.whatsappAudioLanguages?.[selected]||'pt';
      audio.onchange=()=>{audio.disabled=true;void apply(service,()=>api.setAudioLanguage(service.id,audio.value));};
      spoken.append(audio);card.append(spoken);
      const incoming = !!state.whatsappTranslation?.[selected]?.incoming;
      toggle('Traduzir mensagens recebidas para português','incoming',incoming,v=>api.setTranslation(selected,v));
      toggle('Ativar desfoque nesta sessão','enabled',mode==='discreet',v=>api.setPrivacy(selected,v?'discreet':'normal'));
      for(const [key,label] of Object.entries({names:'Nomes de contatos e grupos',avatars:'Fotos dos contatos',previews:'Prévias na lista de conversas',messages:'Texto das mensagens',media:'Fotos, vídeos e outras mídias'}))toggle(label,key,opts[key],v=>api.privacyOptions(selected,{[key]:v}));
      const hint=document.createElement('p');hint.textContent='Controles e escrita continuam disponíveis. Com desfoque ligado, as notificações desta sessão ficam silenciadas.';card.append(hint);
      const reveal=document.createElement('select');reveal.id='privacy-reveal';reveal.setAttribute('aria-label','Como revelar conteúdo');
      for(const [value,label] of [['hover','Revelar ao passar o mouse'],['hold','Revelar segurando Alt sobre o conteúdo']]){const option=document.createElement('option');option.value=value;option.textContent=label;option.selected=value===opts.reveal;reveal.append(option);}reveal.onchange=()=>apply(service,()=>api.privacyOptions(service.id,{reveal:reveal.value}));card.append(reveal);
    }else description.textContent='Abra um workspace com uma sessão do WhatsApp para configurar a privacidade.';
    if(feedback){const error=document.createElement('p');error.setAttribute('role','alert');error.textContent=feedback;card.append(error);}
    const actions=document.createElement('div');actions.className='privacy-actions';card.append(actions);
    const close=document.createElement('button');close.id='privacy-done';close.className='privacy-primary';close.textContent='Concluir';close.onclick=()=>api.privacyPanel(false);actions.append(close);
    const hide=document.createElement('button');hide.textContent='Ocultar todas as sessões';hide.onclick=()=>api.hideAll();actions.append(hide);
    if(!wasOpen)select.focus(); else if(focusedId)document.getElementById(focusedId)?.focus();
  }
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.privacyPanelOpen){event.preventDefault();api.privacyPanel(false);}});
  api.onState(next=>{state={...state,...next};render();});api.getState().then(next=>{state=next;render();});
})();

