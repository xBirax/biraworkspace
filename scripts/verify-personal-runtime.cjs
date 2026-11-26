// Teste do produto real com perfil descartável; nenhuma conta existente é usada.
const { app, BaseWindow, webContents } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const results = path.join(root, '.test-results');
fs.mkdirSync(results, {recursive:true});
process.env.BIRA_TEST_HIDDEN = '1';
process.env.BIRA_TEST_PROFILE = fs.mkdtempSync(path.join(results,'profile-'));
app.setAppPath(path.join(root,'apps/desktop'));
const errors = [];
const requests = [];
app.on('web-contents-created', (_event, wc) => {
  wc.on('render-process-gone', (_e, d) => errors.push(d.reason));
  wc.on('did-fail-load', (_e, code, desc, url) => { if(url.startsWith('file:') && code !== -3) errors.push(desc); });
  wc.on('will-navigate', (_e,url) => requests.push(url));
});
const fixture = '<!doctype html><html><head><title>Laboratório</title></head><body><div id="app"><div id="pane-side"><div role="row"><span title="Contato sintético">Contato sintético</span><span data-testid="cell-frame-secondary" id="preview">Prévia sintética</span></div></div><div id="main"><header>Nome sintético</header><div data-id="m1"><span class="selectable-text" id="message">Mensagem de teste</span><img id="media" alt="Mídia de teste" width="40" height="40"></div><footer><div contenteditable="true">Rascunho de teste</div></footer></div></div></body></html>';
app.on('session-created', ses => {
  ses.protocol.handle('https', req => {requests.push(req.url);return new Response(fixture,{headers:{'content-type':'text/html'}});});
});
require('../apps/desktop/dist/main/index.bundle.cjs');
const wait = ms => new Promise(r=>setTimeout(r,ms));
const checkpoint = name => { console.log(name); fs.appendFileSync(path.join(results,'runtime-progress.log'), name+'\n'); };
const timeout = setTimeout(()=>{console.error('Timeout do smoke');app.exit(1);},90000);
app.whenReady().then(async()=>{
 try {
  let shell;
  for(let i=0;i<100;i++){shell=webContents.getAllWebContents().find(w=>w.getURL().endsWith('/shell/index.html'));if(shell&&!shell.isLoading())break;await wait(100);}
  assert(shell,'shell carregado');
  const invoke = (method,...args)=>shell.executeJavaScript(`window.adrShell[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
  const initial=await invoke('getState');
  checkpoint('boot');
  assert.equal(initial.personal,true);
  assert.equal(initial.update.phase,'disabled');
  assert.equal(initial.activeSurface,'empty');
  assert(!initial.rail.includes('crm'));
  assert.equal(BaseWindow.getAllWindows().length,1);
  assert.equal(app.getName(),'BiraWorkspace');
  assert.equal(app.getPath('userData'),process.env.BIRA_TEST_PROFILE);
  assert(!webContents.getAllWebContents().some(w=>w.getURL().includes('adragencia')));
  const wa=initial.services.find(s=>s.kind==='whatsapp');
  await invoke('show','service:'+wa.id);
  checkpoint('WhatsApp');
  let page;
  for(let i=0;i<100;i++){page=webContents.getAllWebContents().find(w=>w.getURL().startsWith('https://web.whatsapp.com'));if(page&&!page.isLoading())break;await wait(100);}
  assert(page,'WhatsApp abriu sem login CRM');
  assert.equal(await page.executeJavaScript('typeof window.adrCrm'),'undefined');

  // Motor fictício. O cancelamento deve ocorrer enquanto a mídia sintética ainda está pendente.
  process.env.BIRA_WHISPER_CLI=process.execPath;process.env.BIRA_WHISPER_MODEL=__filename;
  await page.executeJavaScript(`(()=>{
    const ids=['false_fixture_above','false_fixture_visible'];
    window.downloads=[];window.mediaReads=0;
    for(const [i,id] of ids.entries()){
      const el=document.createElement('div');el.dataset.id=id;el.style.cssText='position:fixed;left:40px;top:'+(i?120:-2000)+'px';
      el.innerHTML='<audio controls></audio>';document.querySelector('#main').append(el);
    }
    window.WPP={isReady:true,chat:{
      getActiveChat:async()=>({id:{_serialized:'fixture@c.us'}}),
      getMessageById:async id=>({type:'ptt',id:{_serialized:id}}),
      downloadMedia:id=>{window.downloads.push(id);return new Promise(resolve=>{window.finishVoice=()=>{
        const blob=new Blob(['fixture']);blob.arrayBuffer=()=>{window.mediaReads++;return Promise.resolve(new ArrayBuffer(8))};resolve(blob);
      }})}}};
  })()`);
  // O laboratório mantém a janela fora da tela. Exercita a transição de visibilidade
  // nos contextos da página sintética e do preload sem interferir no desktop físico.
  const contexts=[];
  const collect=(_event,method,params)=>{if(method==='Runtime.executionContextCreated')contexts.push(params.context.id);};
  page.debugger.attach('1.3');page.debugger.on('message',collect);
  await page.debugger.sendCommand('Runtime.enable');
  await invoke('setTranscription',wa.id,true);
  for (const contextId of contexts) {
    await page.debugger.sendCommand('Runtime.evaluate',{contextId,expression:"Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))"});
  }
  page.debugger.removeListener('message',collect);page.debugger.detach();
  for(let i=0;i<60&&!await page.executeJavaScript('!!window.finishVoice');i++)await wait(100);
  assert.deepEqual(await page.executeJavaScript('window.downloads'),['false_fixture_visible']);
  await invoke('hideAll');await wait(150);
  await page.executeJavaScript('window.finishVoice()');await wait(200);
  assert.equal(await page.executeJavaScript('window.mediaReads'),0,'mídia descartada antes da decodificação');
  await invoke('setTranscription',wa.id,false);await invoke('restorePrivacy');
  await page.executeJavaScript("document.querySelectorAll('[data-id^=false_fixture]').forEach(n=>n.remove());delete window.WPP");
  await invoke('setPrivacy',wa.id,'discreet');await wait(200);
  const view=BaseWindow.getAllWindows()[0].contentView.children.find(v=>v.webContents===page);
  const filter=id=>page.executeJavaScript('getComputedStyle(document.getElementById('+JSON.stringify(id)+')).filter');
  assert.equal(await filter('message'),'none','mensagens legíveis por padrão');
  assert.match(await filter('media'),/blur/);assert.match(await filter('preview'),/blur/);
  await page.executeJavaScript('for(const kind of ["video","audio"]){const node=document.createElement(kind);node.id="fixture-"+kind;node.controls=true;document.querySelector("#main [data-id]").append(node)}');await wait(100);
  assert.match(await filter('fixture-video'),/blur/,'vídeo desfocado');assert.match(await filter('fixture-audio'),/blur/,'áudio desfocado');
  await invoke('privacyOptions',wa.id,{media:false});await wait(100);
  assert.equal(await filter('media'),'none');assert.equal(await filter('fixture-video'),'none');assert.equal(await filter('fixture-audio'),'none');
  await invoke('privacyOptions',wa.id,{media:true});await wait(100);
  assert.equal(await page.executeJavaScript('document.querySelectorAll(".bira-reveal").length'),0,'sem botões sobre mensagens');
  assert.equal(await page.executeJavaScript('getComputedStyle(document.querySelector("footer")).filter'),'none','compositor utilizável');
  await invoke('privacyOptions',wa.id,{messages:true});await wait(100);
  assert.match(await filter('message'),/blur/);
  await page.executeJavaScript('document.getElementById("message").dispatchEvent(new PointerEvent("pointerover",{bubbles:true}))');
  assert.match(await filter('message'),/blur/,'evento sintético não revela');
  page.debugger.attach('1.3');page.focus();
  await page.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  const move=async(id)=>{const point=await page.executeJavaScript('(()=>{const r=document.getElementById('+JSON.stringify(id)+').getBoundingClientRect();return {x:r.x+3,y:r.y+3};})()');await page.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await wait(80);};
  await move('message');assert.equal(await filter('message'),'none','hover revela');
  await wait(5200);assert.equal(await filter('message'),'none','sem prazo artificial');
  await page.executeJavaScript('const extra=document.createElement("p");extra.textContent="Nova mensagem";document.body.append(extra)');await wait(100);
  assert.equal(await filter('message'),'none','atualização externa não interrompe leitura');
  await move('preview');assert.match(await filter('message'),/blur/,'sair oculta');
  await invoke('privacyOptions',wa.id,{reveal:'hold'});await wait(100);await move('message');assert.match(await filter('message'),/blur/);
  await page.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'Alt',code:'AltLeft',windowsVirtualKeyCode:18});await wait(50);
  assert.equal(await filter('message'),'none','Alt revela');
  await move('preview');assert.equal(await filter('preview'),'none','Alt mantido revela próximo elemento');
  await move('message');assert.equal(await filter('message'),'none');
  await page.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'Alt',code:'AltLeft',windowsVirtualKeyCode:18});await wait(50);
  assert.match(await filter('message'),/blur/,'soltar Alt oculta');page.debugger.detach();
  await invoke('privacyPanel',true);await wait(100);
  const overlay=webContents.getAllWebContents().find(w=>w.getURL().endsWith('/overlay.html'));
  assert.equal(await overlay.executeJavaScript('document.getElementById("bira-privacy-ui").hidden'),false);
  assert.equal(await overlay.executeJavaScript('document.getElementById("privacy-messages").checked'),true);
  const write=fs.renameSync;
  const denyStateWrite=(source,dest)=>{
    if (path.basename(dest)==='state.v1.json') throw Object.assign(Error('Disco cheio no perfil de teste'),{code:'ENOSPC'});
    return write(source,dest);
  };
  const check='document.getElementById("privacy-transcription")';
  const savedValue=await overlay.executeJavaScript(check+'.checked');
  try {
    fs.renameSync=denyStateWrite;
    await overlay.executeJavaScript(check+'.click()');
    for(let i=0;i<40&&!await overlay.executeJavaScript('!!document.querySelector("#bira-privacy-ui [role=alert]")');i++)await wait(50);
    assert.equal(await overlay.executeJavaScript(check+'.checked'),savedValue);
    assert((await overlay.executeJavaScript('document.querySelector("#bira-privacy-ui [role=alert]").textContent')).includes(wa.name));
  } finally {fs.renameSync=write;}
  await invoke('privacyPanel',false);
  await invoke('addService','whatsapp','Conta de teste 2');
  const second=(await invoke('getState')).services.find(s=>s.kind==='whatsapp' && s.id!==wa.id);
  assert(second);await invoke('setPrivacy',second.id,'presentation');
  await invoke('show','service:'+wa.id);
  try {
    fs.renameSync=denyStateWrite;
    assert.equal((await invoke('hideAll')).ok,false);
    assert.equal(view.getVisible(),false,'falha de disco mantém todas as contas cobertas');
  } finally {fs.renameSync=write;}
  await invoke('hideAll');await wait(100);assert.equal(view.getVisible(),false);assert.equal(page.isAudioMuted(),true,'ocultar silencia áudio');
  assert.equal(await overlay.executeJavaScript('document.getElementById("privacy-return").textContent'),'Voltar às conversas');
  await invoke('restorePrivacy');await wait(100);assert.equal((await invoke('getState')).whatsappPrivacyModes[wa.id],'discreet');assert.equal(view.getVisible(),true);assert.equal(page.isAudioMuted(),false,'restaura áudio anterior');
  assert.equal((await invoke('getState')).whatsappPrivacyModes[second.id],'presentation','preserva conta ocultada antes do grupo');
  await page.executeJavaScript('window.savedSide=document.getElementById("pane-side");window.savedSide.remove()');await wait(100);assert.equal(view.getVisible(),false);
  await page.executeJavaScript('window.savedMain=document.getElementById("main");window.savedMain.remove();const qr=document.createElement("canvas");qr.setAttribute("aria-label","QR");qr.id="pairing-fixture";document.body.append(qr)');
  await wait(100);assert.equal(view.getVisible(),true,'pareamento disponível no modo discreto');
  await page.executeJavaScript('document.getElementById("pairing-fixture").remove();document.getElementById("app").append(window.savedMain)');
  await page.executeJavaScript('document.getElementById("app").prepend(window.savedSide)');await wait(100);assert.equal(view.getVisible(),true);
  await invoke('setPrivacy',wa.id,'normal');await wait(100);assert.equal(await filter('message'),'none');
  await invoke('hideAll');await wait(100);
  const persisted=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'state.v1.json'),'utf8'));
  assert.equal(persisted.settings.whatsappPrivacyModes[wa.id],'presentation');
  assert.equal(persisted.settings.whatsappPrivacyOptions[wa.id].reveal,'hold');
  const respond = async (pin, priorUrl='') => {
    for(let i=0;i<400;i++){
      const prompt=webContents.getAllWebContents().find(w=>w.getURL().includes('/prompt.html?')&&w.getURL()!==priorUrl);
      if(prompt&&!prompt.isLoading()) {
        const top=BaseWindow.getAllWindows()[0].contentView.children.filter(v=>v.getVisible()).at(-1);
        assert.equal(top.webContents,prompt,'PIN fica acima da tela de privacidade');
        const url=prompt.getURL();
        // O envio destrói este renderer e abre o próximo diálogo. Não aguardar
        // uma resposta JS no contexto destruído; observar o resultado no shell.
        void prompt.executeJavaScript(`void window.adrPrompt.submit(${JSON.stringify(pin)},new URLSearchParams(location.search).get('id'));`).catch(()=>{});
        return url;
      }
      await wait(50);
    }
    console.log('Páginas do laboratório:',webContents.getAllWebContents().map(w=>w.getURL().split('?')[0]));
    throw Error('Prompt de PIN não apareceu');
  };
  const enabling=invoke('enableWhatsAppLock',wa.id);
  checkpoint('solicitado PIN');
  void enabling.then(result=>console.log('Ativação PIN:',JSON.stringify(result)));
  const firstPrompt=await respond('1234');checkpoint('PIN inicial');await respond('1234',firstPrompt);checkpoint('PIN confirmado');
  assert.equal((await enabling).ok,true);
  await invoke('show','service:'+wa.id);
  await respond('1234');await wait(150);
  assert.equal((await invoke('getState')).activeSurface,'service:'+wa.id);
  assert.equal(view.getVisible(),false,'desbloquear PIN não revela apresentação');
  await invoke('show','settings','privacidade');
  let panel;
  for(let i=0;i<100;i++){panel=webContents.getAllWebContents().find(w=>w.getURL().includes('/panel.html'));if(panel&&!panel.isLoading())break;await wait(50);}
  assert(panel,'configurações carregadas');
  assert.equal(await panel.executeJavaScript('getComputedStyle(document.getElementById("btn-crm-logout")).display'),'none');
  assert.equal(await panel.executeJavaScript('getComputedStyle(document.querySelector(\'nav [data-tab="desempenho"]\')).display'),'none');
  await invoke('createWorkspace','Laboratório');
  let next=await invoke('getState');
  assert.equal(next.workspaces.length,2);
  const destination=next.activeWorkspaceId;
  const originalContents=page.id, originalSession=page.session;
  await page.executeJavaScript('window.moveMarker="preserved";document.querySelector("footer [contenteditable]").textContent="Rascunho não enviado"');
  await page.session.cookies.set({url:'https://web.whatsapp.com',name:'move-fixture',value:'preserved'});
  assert.equal(await shell.executeJavaScript(`document.querySelector('[data-nav-id="${wa.id}"]').draggable`),true,'importado/inativo também pode ser arrastado');
  await shell.executeJavaScript(`(()=>{const d=new DataTransfer();d.setData('text/service-id',${JSON.stringify(wa.id)});document.querySelectorAll('.workspace-heading')[1].dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));})()`);
  await wait(150);
  let moved=await invoke('getState');assert.equal(moved.activeWorkspaceId,destination);
  assert(moved.services.some(s=>s.id===wa.id),'serviço movido pelo drop no workspace');
  assert.equal(page.id,originalContents);assert.equal(page.session,originalSession);
  assert.equal(await page.executeJavaScript('window.moveMarker'),'preserved');
  assert.equal(await page.executeJavaScript('document.querySelector("footer [contenteditable]").textContent'),'Rascunho não enviado');
  assert.equal((await page.session.cookies.get({name:'move-fixture'}))[0].value,'preserved');
  assert.equal(moved.whatsappPrivacyModes[wa.id],'presentation');
  assert.equal((await invoke('moveService',wa.id,'missing')).ok,false);
  const originalSend=page.send;
  try {
    page.send=function(channel,...args){if(channel==='bira:privacy-conceal')throw Error('Navegação de teste interrompida');return originalSend.call(this,channel,...args);};
    const committed=await invoke('moveService',wa.id,initial.activeWorkspaceId);
    assert(committed.ok && committed.message.includes('movido'));
    const saved=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'state.v1.json'),'utf8'));
    assert.equal(saved.services.find(service=>service.id===wa.id).workspaceId,initial.activeWorkspaceId);
  } finally {page.send=originalSend;}
  await invoke('setWorkspace',initial.activeWorkspaceId);
  assert.equal((await invoke('getState')).activeWorkspaceId,initial.activeWorkspaceId);
  assert.equal(page.id,originalContents);
  await invoke('setWorkspace',initial.activeWorkspaceId);
  next=await invoke('getState');
  assert.equal(next.activeWorkspaceId,initial.activeWorkspaceId);
  assert.notEqual(next.activeSurface,'crm');
  const updates=await invoke('checkUpdates');
  assert.equal(updates.phase,'disabled');
  assert.equal(errors.length,0,errors.join('\n'));
  assert(!requests.some(u=>u.includes('adragencia')));
  fs.writeFileSync(path.join(results,'personal-runtime.json'),JSON.stringify({passed:true,profile:app.getPath('userData'),checks:['boot sem CRM','perfil isolado','shell carregado','uma janela real','WhatsApp sem gate CRM','preload sem ponte CRM','desfoque por categoria','compositor livre','revelação por hover sem prazo','leitura não interrompida por atualização externa','Alt pressionado revela','soltar Alt oculta','painel acessível','ocultação com retorno às preferências','DOM desconhecido coberto','apresentação coberta pelo main','retorno normal','ocultar tudo','preferência persistida','ativação e confirmação de PIN','desbloqueio não altera apresentação','configurações sem CRM e otimizador','criação e troca de workspace','updater desativado','sem navegação ADR'],errors,requests},null,2));
  checkpoint('PASS: runtime pessoal, PIN, mídia, transferência com sessão/rascunho preservados e navegação sem CRM');
  const other=webContents.getAllWebContents().map(w=>w.session).find(session=>session!==page.session);
  assert(other);
  const flushed=new Set();
  page.session.cookies.flushStore=async()=>{flushed.add('cookies-failed');throw Error('Falha simulada');};
  page.session.flushStorageData=()=>{flushed.add('storage');};
  other.flushStorageData=()=>{flushed.add('other');};
  app.once('will-quit',()=>{
    if(flushed.size!==3){console.error('Etapas incompletas no fechamento', [...flushed]);process.exitCode=1;}
    else checkpoint('PASS: falha em cookies preserva gravação local e outra partição');
  });
  clearTimeout(timeout);app.quit();
 } catch(e){console.error(e);clearTimeout(timeout);app.exit(1);}
});
