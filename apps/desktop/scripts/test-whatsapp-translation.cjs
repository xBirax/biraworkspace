// Electron integration test with an in-memory WhatsApp origin and a local send recorder.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const preloadDir=process.env.BIRA_TEST_PRELOAD_DIR || path.join(root,'dist/preload');
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'bira-translation-test-'));
app.setPath('userData',profile);
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
const url='https://Example.COM/Ver%20Pedido?Token=aB%2F9&idioma=pt#Resumo';
const shortLink='wa.me/5511000000000?text=Bom%20dia';
const html = `<!doctype html><meta charset=utf-8><body><div id=pane-side><div aria-selected="true"></div></div>
<div id=main><header><span title="Fixture">Fixture</span></header>
<div role=row><div data-id="false_fixture" style="width:500px"><div class="copyable-text"><span class="selectable-text">The package will arrive tomorrow morning. ${url}</span></div></div></div>
<div role=row><div data-id="false_spanish" style="width:300px"><span class="selectable-text">El paquete llegará mañana por la mañana.</span></div></div>
<div role=row><div data-id="false_portuguese" style="width:300px"><span class="selectable-text">Vamo testar a entrega?</span></div></div>
<div role=row><div data-id="false_link"><span class="selectable-text">${url}</span></div></div>
<footer style="margin-top:150px;display:flex"><div role=textbox contenteditable=true style="width:300px;min-height:26px"></div><button aria-label="Enviar">Enviar</button></footer></div>
<script>
window.sent=[];const editor=document.querySelector('[contenteditable]'), button=document.querySelector('button');
button.onclick=()=>{sent.push(editor.innerText);editor.innerText=''};
editor.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();button.click()}};
editor.onpaste=e=>{e.preventDefault();editor.innerText=e.clipboardData.getData('text/plain')};
</script>`;
let translator, win;
app.whenReady().then(async()=>{
  const {LocalTranslation}=await import(pathToFileURL(path.join(root,'dist/main/local-translation.js')).href);
  translator=new LocalTranslation(path.join(preloadDir,'translate-worker.py'));
  const languages = new Map();
  const reviewChats = new Set();
  let key='first', changed=false, fail=false, switchDuringTranslation=false;
  const contactRequests=[];
  ipcMain.handle('bira:open-google-contact',(_event,expected)=>{contactRequests.push(expected);return expected===key});
  const context=()=>({key,individual:key!=='group',language:languages.get(key)||'off',review:reviewChats.has(key)});
  const prefs=()=>({incoming:true,hasTranslatedChats:languages.size>0});
  let releasePreferences, initialReads=0;
  ipcMain.handle('bira:translation-settings',async()=>{
    initialReads++;
    if(initialReads===1)return null;
    if(initialReads===2)await new Promise(r=>{releasePreferences=r});
    return prefs();
  });
  let holdRead=false,releaseRead;
  ipcMain.handle('bira:translation-chat',async()=>{
    const snapshot=context();
    if(holdRead){holdRead=false;await new Promise(resolve=>{releaseRead=resolve})}
    return snapshot;
  });
  ipcMain.handle('bira:set-chat-language',(_event,expected,language,review)=>{
    if(expected!==key)return null;
    if(language==='off')languages.delete(key);else languages.set(key,language);
    if(review===true)reviewChats.add(key);
    if(review===false)reviewChats.delete(key);
    return {...context(),...prefs()};
  });
  ipcMain.handle('bira:transcription-status',()=>false);
  ipcMain.handle('bira:translate-text',async(_event,text,target)=>{
    if(switchDuringTranslation && target!=='pt') key='third';
    if(fail) return {error:'fixture'};
    if(changed) await win.webContents.executeJavaScript("document.querySelector('[contenteditable]').innerText='Rascunho editado'");
    return translator.translate(text,target);
  });
  const ses=session.fromPartition('translation-fixture');
  ses.protocol.handle('https',req=>new Response(req.url==='https://web.whatsapp.com/'?html:'',{headers:{'Content-Type':'text/html; charset=utf-8'}}));
  win=new BrowserWindow({width:720,height:520,show:false,webPreferences:{offscreen:true,backgroundThrottling:false,session:ses,preload:path.join(preloadDir,'personal-privacy.cjs'),sandbox:true,contextIsolation:true}});
  win.webContents.on('preload-error',(_e,_file,error)=>console.error(error));
  win.webContents.on('console-message',(_e,details)=>{if(details.level==='error')console.error(details.message)});
  await win.loadURL('https://web.whatsapp.com/');
  const js=code=>win.webContents.executeJavaScript(code);
  async function until(code) {
    for(let i=0;i<200;i++){const result=await js(code);if(result)return result;await wait(150)}
    throw Error('Timed out: '+code);
  }
  console.log('fixture',await js("({hidden:document.hidden,rows:document.querySelectorAll('#main [role=row]').length})"));
  await js("editor.innerText='Rascunho inicial';editor.focus();true");
  const editorPoint=await js("(()=>{const r=editor.getBoundingClientRect();return {x:Math.round(r.left+4),y:Math.round(r.top+4)}})()");
  for(const type of ['mouseDown','mouseUp'])win.webContents.sendInputEvent({type,button:'left',clickCount:1,...editorPoint});
  await wait(100);
  for(const type of ['keyDown','keyUp'])win.webContents.sendInputEvent({type,keyCode:'Return'});
  await wait(150);
  console.log('inicialização',initialReads,await js("({foco:document.activeElement===editor,enviadas:sent.length,status:document.querySelector('[data-bira-chat-controls]')?.shadowRoot?.querySelector('[role=status]')?.textContent})"));
  assert.equal(await js("document.querySelector('[data-bira-chat-controls]')?.shadowRoot?.querySelector('[role=status]')?.textContent.includes('Carregando')"),true);
  assert.equal(await js("editor.innerText"),'Rascunho inicial');assert.equal(await js("sent.length"),0);
  for(let i=0;i<25&&!releasePreferences;i++)await wait(100);
  assert.equal(typeof releasePreferences,'function');releasePreferences();
  const incoming=await until("document.querySelector('[data-id=false_fixture] [data-bira-translation]')?.innerText");
  assert.match(incoming,/pacote/i);
  assert(incoming.includes(url));
  for (const question of ['Where is the bus stop?', '¿Dónde está la parada de autobús?']) {
    const translated = await translator.translate(question, 'pt');
    assert.match(translated.text, /ônibus/i, 'Português brasileiro nas traduções recebidas');
  }
  assert.match(await until("document.querySelector('[data-id=false_spanish] [data-bira-translation]')?.innerText"),/pacote/i);
  assert.equal(await js("document.querySelector('[data-id=false_portuguese] [data-bira-translation]')===null"),true);
  for(const text of ['Olá','Combinado!','blz','manda o link','show','Ok 👍','Olha isso: https://example.com/very/long/english/path']) {
    assert.equal((await translator.translate(text,'pt')).unchanged,true,text);
  }
  for(const target of ['pt','en','es']){
    const onlyLinks=[url,shortLink,'www.exemplo.com.br','bit.ly/aB9','https://[::1]:443/A',
      'https://münchen.example/Café','t.me/Bira','localhost:3000/MeuPedido','magnet:?xt=urn:btih:012345','contato@exemplo.com.br'].join('\r\n');
    assert.deepEqual(await translator.translate(onlyLinks,target),{text:onlyLinks,unchanged:true});
  }
  assert.equal(await js("document.querySelector('[data-id=false_link] [data-bira-translation]')"),null);
  const mixed=await translator.translate('Abra o pedido aqui: '+url+' e confirme sua presença amanhã.','en');
  assert.match(mixed.text.split(url)[0],/order/i);
  assert.match(mixed.text.split(url)[1],/tomorrow/i);
  const businessCases=[
    ['O pagamento é à vista.',/payment is due in full upfront/i],
    ['O pagamento não é à vista.',/payment is not due upfront/i],
    ['Favor enviar a segunda via do boleto.',/Please send a copy of the payment slip/i],
    ['Não envie a segunda via do boleto.',/(?:not|n.t) send a copy of the payment slip/i],
    ['O vencimento do boleto é amanhã.',/payment slip is due tomorrow/i],
    ['O prazo para pagamento é de quinze dias corridos.',/15 calendar days/i],
    ['Preciso dos valores do projeto e dos valores da empresa.',/rates.*values/i],
    ['valor',/^rate$/i],
    ['Valores',/^rates$/i],
    ['Quais são os valores?',/^What are the rates\?$/],
    ['Você pode me enviar os valores?',/^Could you send me the rates\?$/],
    ['Pode mandar os valores do projeto?',/\brates\b/i],
    ['Os valores da empresa são integridade e respeito.',/\bvalues\b.*integrity.*respect/i],
    ['Digite os valores na planilha.',/\bvalues\b.*spreadsheet/i],
    ['Fico no aguardo do seu retorno.',/^I look forward to hearing from you\.$/],
    ['Bom dia, Ana. Segue em anexo a proposta comercial.',/^Good morning, Ana\. .*proposal.*attached/i],
    ['Não envie os valores por enquanto.',/(?:not|n.t) send the rates/i],
    ['O valor por hora é de R$ 150,00.',/(?=.*rate)(?=.*150)/i],
    ['Você poderia me dar um retorno sobre a proposta até sexta-feira?',/(?=.*back to me)(?=.*proposal)(?=.*Friday)/i],
    ['O retorno do investimento ficou abaixo do esperado.',/return on investment/i],
  ];
  for(const [source,expected] of businessCases)assert.match((await translator.translate(source,'en')).text,expected,source);
  const businessLink=await translator.translate('Confira os valores: '+url+'\r\nAguardo seu retorno.','en');
  assert.equal(businessLink.text,'Check the rates: '+url+'\r\nI look forward to your response.');
  const glossary=[{source:'valores',target:'contract rates'},{source:'tabela de valores',target:'rate card'},
    {source:'Podemos rever os valores?',target:'Could we review the agreed rates?'}];
  const custom=async(text,target='en',terms=glossary)=>(await translator.translate(text,target,undefined,terms)).text;
  assert.equal(await custom('VALORES'),'contract rates');
  assert.match(await custom('Os valores da empresa são integridade e respeito.'),/values.*integrity/i);
  assert.match(await custom('Digite os valores na planilha.'),/values.*spreadsheet/i);
  assert.match(await custom('Envie os valores do frete. Os valores da empresa não mudaram.'),/contract rates.*values/i);
  assert.match(await custom('Pode me enviar os valores?'),/send me the contract rates\?/i);
  assert.equal(await custom('Podemos rever os valores?'),'Could we review the agreed rates?');
  assert.equal(await custom('tabela de valores'),'rate card');
  assert.equal(await custom('valores\r\n'+url),'contract rates\r\n'+url);
  assert(!/contract rates/.test(await custom('Os desvalores.')));
  assert(!/contract rates/.test(await custom('Pode me enviar os valores?','es')));
  assert.equal(await custom('valores','en',[{source:'valores',target:'fees'}]),'fees');
  assert.equal(await custom('valores','en',[]),'rates');
  const unavailable=new LocalTranslation('missing-worker.py');
  try {assert.deepEqual(await unavailable.translate('localhost:3000/MeuPedido\nmagnet:?xt=abc','en'),{text:'localhost:3000/MeuPedido\nmagnet:?xt=abc',unchanged:true});} finally {unavailable.close();}
  const draft="Podemos agendar uma reunião amanhã de manhã? "+url+"\n"+shortLink;
  const write=()=>js("editor.innerText="+JSON.stringify(draft)+";editor.focus();true");
  const enter=()=>{win.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'})};
  const controls="document.querySelector('[data-bira-chat-controls]').shadowRoot";
  const active=controls+".querySelector('button[aria-pressed=true]')?.value";
  const notice=controls+".querySelector('[data-bira-send-status]').textContent";
  const buttonFor=value=>controls+".querySelector('button[value="+value+"]')";
  async function clickControl(button) {
    await until(button+" && !"+button+".disabled && "+button+".getBoundingClientRect().width>0");
    const point=await js(`(()=>{const b=${button}, r=b.getBoundingClientRect();
      const x=Math.floor(r.x+r.width/2), y=Math.floor(r.y+r.height/2);
      if(document.elementFromPoint(x,y)!==b.getRootNode().host || b.getRootNode().elementFromPoint(x,y)!==b)throw Error('Botão encoberto');
      return {x,y}})()`);
    for(const type of ['mouseDown','mouseUp'])win.webContents.sendInputEvent({type,button:'left',clickCount:1,...point});
  }
  const contact="document.querySelector('#main header [data-bira-google-contact]').shadowRoot.querySelector('button')";
  await js(contact+".click()");
  assert.equal(contactRequests.length,0);
  await clickControl(contact);
  await until(contact+" && !"+contact+".disabled");await wait(80);
  assert.deepEqual(contactRequests,[key]);
  key='group';
  await js("document.querySelector('#main header span').title='Grupo';true");
  await until("!document.querySelector('[data-bira-google-contact]')");
  key='first';
  await js("document.querySelector('#main header span').title='Fixture';true");
  await until("!!document.querySelector('[data-bira-google-contact]')");
  async function choose(value) {
    const button=buttonFor(value);
    await clickControl(controls+".querySelector('.trigger')");
    await clickControl(button);
    await until(active+" === "+JSON.stringify(value)+" && !"+button+".disabled");
    assert.equal(context().language,value);
  }
  assert.equal(win.isVisible(),false);
  await until(buttonFor('en')+" && !"+buttonFor('en')+".disabled");
  holdRead=true;
  for(let i=0;i<175 && !releaseRead;i++)await wait(100);
  assert.equal(typeof releaseRead,'function');
  await choose('en');
  releaseRead();await wait(300);
  assert.equal(await js(active),'en','Uma leitura anterior ao clique não pode desfazer a seleção');
  const preview=process.env.BIRA_LANGUAGE_PREVIEW;
  if(preview){
    const bounds=await js(`(()=>{const r=document.querySelector('[data-bira-chat-controls]').getBoundingClientRect();
      return {x:Math.ceil(r.x),y:Math.ceil(r.y),width:Math.floor(r.width),height:Math.floor(r.height)}})()`);
    fs.writeFileSync(preview,(await win.webContents.capturePage(bounds)).toPNG());
  }
  await write();enter();enter();
  const english=await until('window.sent[0]');assert.match(english,/meeting/i);assert(!english.includes('▁'));
  await wait(250);assert.equal(await js('sent.length'),1);
  key='second';await js("document.querySelector('#main header').replaceWith(document.querySelector('#main header').cloneNode(true));true");
  await until(active+"==='off'");
  await choose('es');
  await choose('off');
  await choose('es');
  await wait(100);await write();
  const point=await js("(()=>{const b=button.getBoundingClientRect();return {x:Math.round(b.x+5),y:Math.round(b.y+5)}})()");
  for(const type of ['mouseDown','mouseUp'])win.webContents.sendInputEvent({type,button:'left',clickCount:1,...point});
  const spanish=await until('window.sent[1]');assert.match(spanish,/reunión/i);
  for(const sent of [english,spanish])assert(sent.endsWith(' '+url+'\n'+shortLink));
  fail=true;await write();enter();
  await until(notice+".includes('interrompido')");
  assert.equal(await js('editor.innerText'),draft);assert.equal(await js('sent.length'),2);
  fail=false;changed=true;await write();enter();
  await until(notice+".includes('rascunho mudou')");
  assert.equal(await js('editor.innerText'),'Rascunho editado');assert.equal(await js('sent.length'),2);
  changed=false;switchDuringTranslation=true;await write();enter();
  await until(active+"==='off' && document.querySelector('[data-bira-chat-controls]').getAttribute('aria-busy')==='false'");assert.equal(await js('sent.length'),2);
  assert.equal(await js('editor.innerText'),draft);
  switchDuringTranslation=false;await write();enter();
  assert.equal(await until('sent[2]'),draft);
  key='first';await js("document.querySelector('#main header').replaceWith(document.querySelector('#main header').cloneNode(true));true");await until(active+"==='en'");
  await js("editor.innerText="+JSON.stringify(url)+";editor.focus();true");enter();
  assert.equal(await until('sent[3]'),url);
  // A gravação do texto traduzido sucede, mas o botão do WhatsApp desaparece.
  await js("window.removeSend=()=>button.remove();editor.addEventListener('paste',window.removeSend,{once:true});true");
  await write();enter();
  await until(notice+".includes('indisponível')");
  assert.equal(await js('editor.innerText'),draft);
  assert.equal(await js('sent.length'),4);
  await js("editor.parentElement.append(button);true");
  await js("editor.innerText='';const mention=document.createElement('span');mention.contentEditable='false';mention.textContent='@Fixture';editor.append(mention);editor.focus();true");
  enter();
  await until('!!'+controls+".querySelector('[role=status] button')");
  await clickControl(controls+".querySelector('[role=status] button')");
  assert.equal(await until('sent[4]'),'@Fixture');assert.equal(context().language,'en');
  const dialog=controls+".querySelector('.review')";
  const toggle=controls+".querySelector('.review-option')";
  await clickControl(controls+".querySelector('.trigger')");await clickControl(toggle);
  await until(toggle+".getAttribute('aria-checked')==='true'");
  await write();enter();await until(dialog);
  assert.equal(await js('sent.length'),5);assert.equal(await js('editor.innerText'),draft);
  assert((await js(dialog+".querySelector('textarea').value")).endsWith(url+'\n'+shortLink));
  await clickControl(dialog+".querySelector('button')");
  assert.equal(await js('editor.innerText'),draft);assert.equal(await js('sent.length'),5);
  await write();enter();await until(dialog);
  await js(dialog+".querySelector('textarea').value='Approved wording';true");
  await clickControl(dialog+".querySelector('button:last-child')");
  assert.equal(await until('sent[5]'),'Approved wording');
  await write();enter();await until(dialog);
  key='second';
  await js("document.querySelector('#main header').replaceWith(document.querySelector('#main header').cloneNode(true));true");
  await until('!'+dialog);await until(active+"==='es'");
  assert.equal(await js(toggle+".getAttribute('aria-checked')"),'false');
  assert.equal(await js('sent.length'),6);assert.equal(await js('editor.innerText'),draft);
  console.log(JSON.stringify({english,spanish,portuguese:draft,clickedAllDestinations:true,staleReadIgnored:true,duplicateBlocked:true,failurePreservesDraft:true,editCancelsSend:true,chatSwitchCancelsSend:true}));

}).catch(err=>{console.error(err);process.exitCode=1}).finally(()=>{
  translator?.close();win?.destroy();app.exit(process.exitCode||0);
});
