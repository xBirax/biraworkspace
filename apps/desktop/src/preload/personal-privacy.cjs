/* global document, addEventListener, MutationObserver */
(() => {
  const {ipcRenderer}=require('electron');
  let mode=process.argv.find(a=>a.startsWith('--bira-privacy='))?.split('=')[1] || 'normal';
  let options={names:false,avatars:false,previews:true,messages:false,media:true,reveal:'hover'};
  try { Object.assign(options,JSON.parse(process.argv.find(a=>a.startsWith('--bira-options='))?.slice(15)||'{}')); } catch { /* defaults */ }
  let style, observer, pending=false, lastStatus='', hovered=null, held=false;
  const revealed=new Set();
  const selectors={
    names:'#pane-side [data-testid="cell-frame-title"], #pane-side [role="row"] [title], #main header [title]',
    avatars:'#pane-side img, #main header img',
    previews:'#pane-side [data-testid="cell-frame-secondary"], #pane-side [data-testid="last-msg"], #pane-side [data-testid="chatlist-last-message"], #pane-side [role="gridcell"]:last-child span[dir="ltr"]',
    messages:'#main [data-bira-translation], #main [data-bira-transcript], #main [data-id] .copyable-text, #main [data-id] [data-testid="msg-text"], #main [data-id] .selectable-text',
    media:'#main [data-bira-transcript], #main [data-id] img, #main [data-id] video, #main [data-id] canvas, #main [data-id] audio, [data-animate-modal-popup] img, [data-animate-modal-popup] video, [role="dialog"] img, [role="dialog"] video'
  };
  function conceal(resetHold=true){ for(const node of revealed)node.removeAttribute('data-bira-peek');revealed.clear();if(resetHold)held=false; }
  function reveal(node){
    for(const old of revealed)old.removeAttribute('data-bira-peek');revealed.clear();
    if(mode!=='discreet'||!node||!document.hasFocus())return;
    for(let current=node;current;current=current.parentElement){if(current.hasAttribute('data-bira-mask')){current.setAttribute('data-bira-peek','');revealed.add(current);}}
  }
  function scan(scope=document){
    pending=false;if(!document.documentElement)return;
    if(!style){style=document.createElement('style');style.textContent='html[data-bira-mode="discreet"] [data-bira-mask]:not([data-bira-peek]) {filter:blur(7px)!important;user-select:none!important;} html[data-bira-mode="presentation"] body {visibility:hidden!important;}';document.documentElement.append(style);}
    document.documentElement.dataset.biraMode=mode;
    const candidates=selector=>scope===document ? document.querySelectorAll(selector) :
      [...(scope.matches(selector)?[scope]:[]),...scope.querySelectorAll(selector)];
    const protectedNodes=new Set();
    if(mode==='discreet')for(const [category,selector] of Object.entries(selectors))if(options[category])for(const node of candidates(selector)){
      // Names: only the first titled element of a chat row is its label.
      if(category==='names'&&node.closest('#pane-side [role="row"]')&&node.hasAttribute('title')&&node.closest('[role="row"]').querySelector('[title]')!==node)continue;
      protectedNodes.add(node);
    }
    for(const node of candidates('[data-bira-mask]'))if(!protectedNodes.has(node)){node.removeAttribute('data-bira-mask');node.removeAttribute('data-bira-peek');revealed.delete(node);}
    for(const node of protectedNodes)if(!node.hasAttribute('data-bira-mask'))node.setAttribute('data-bira-mask','');
    reportReady();
  }
  function reportReady(){
    const ready=mode==='normal'||!!document.querySelector('#pane-side')||
      (!document.querySelector('#main') && !!document.querySelector('[data-testid="qrcode"],[data-ref] canvas,canvas[aria-label*="QR" i]'));
    const status=mode+':'+ready;if(status!==lastStatus){lastStatus=status;ipcRenderer.send('bira:privacy-ready',{mode,ready});}
  }
  function queue(){if(!pending){pending=true;queueMicrotask(scan);}}
  document.addEventListener('pointerover',event=>{
    if(!event.isTrusted)return;hovered=event.target.closest?.('[data-bira-mask]')||null;
    if(options.reveal==='hover'||held)reveal(hovered);
  },true);
  document.addEventListener('pointerout',event=>{
    if(!event.isTrusted)return;
    if(hovered&&!hovered.contains(event.relatedTarget)){conceal(false);hovered=null;}
  },true);
  document.addEventListener('keydown',event=>{
    if(!event.isTrusted)return;
    if(event.key==='Escape')conceal();
    if(event.key==='Alt'&&options.reveal==='hold'&&mode==='discreet'){event.preventDefault();held=true;reveal(hovered);}
  },true);
  document.addEventListener('keyup',event=>{if(event.key==='Alt')conceal();},true);
  ipcRenderer.on('bira:privacy-options',(_e,value)=>{conceal();options={...options,...value};queue();});
  ipcRenderer.on('bira:privacy-mode',(_e,value)=>{conceal();lastStatus='';mode=['normal','discreet','presentation'].includes(value)?value:'presentation';queue();});
  ipcRenderer.on('bira:privacy-conceal',conceal);
  addEventListener('blur',conceal);document.addEventListener('visibilitychange',conceal);
  const start=()=>{
    scan();observer=new MutationObserver(records=>{
      if(records.some(r=>[...revealed].some(node=>node.contains(r.target)||!node.isConnected)))conceal();
      if (pending) return;
      const roots=new Set();
      for (const record of records) {
        const node=record.target.nodeType===1?record.target:record.target.parentElement;
        if (!node) continue;
        const row=node.closest('[role=row],[data-id],header,[role=dialog]');
        if (row || record.type==='attributes') roots.add(row||node);
        else for (const added of record.addedNodes) if (added.nodeType===1) roots.add(added);
      }
      if (!roots.size) reportReady();
      for (const node of roots) if (node.isConnected) scan(node);
    });
    observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-id','title','src','data-testid','data-ref','role','aria-label']});
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  addEventListener('pagehide',()=>{conceal();observer?.disconnect();},{once:true});
})();
