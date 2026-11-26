// O processo pai cria um perfil temporário e reinicia o Electron com o mesmo disco.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
if (!process.versions.electron) {
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'bira-glossary-'));
  for (const phase of ['save','reopen']) {
    require('node:child_process').execFileSync(process.execPath,[
      path.join(__dirname,'run-electron-test.cjs'),__filename,phase
    ],{stdio:'inherit',env:{...process.env,BIRA_TEST_PROFILE:profile,BIRA_TEST_HIDDEN:'1'}});
  }
} else {
  const {app,webContents,session,ipcMain}=require('electron');
  const profile=process.env.BIRA_TEST_PROFILE;
  assert(profile && path.dirname(profile)===os.tmpdir() && path.basename(profile).startsWith('bira-glossary-'));
  const preload=path.join(profile,'glossary-probe.cjs');
  fs.writeFileSync(preload,`
    const {ipcRenderer}=require('electron');
    ipcRenderer.on('fixture:check',async (_event,text,review,firstRun)=>{
      try {
        const chat=await ipcRenderer.invoke('bira:translation-chat');
        if (chat.review !== (firstRun ? false : review)) throw Error('Preferência inesperada');
        const saved=await ipcRenderer.invoke('bira:set-chat-language',chat.key,'en',review);
        if (saved.review!==review || (await ipcRenderer.invoke('bira:translation-chat')).review!==review)
          throw Error('Prévia por conta e conversa não gravada');
        const result=await ipcRenderer.invoke('bira:translate-text',text,'en',chat.key);
        ipcRenderer.send('fixture:result',result.text);
      } catch {ipcRenderer.send('fixture:result',null);}
    });`);
  app.on('session-created',ses=>{
    ses.registerPreloadScript({type:'frame',filePath:preload});
    ses.protocol.handle('https',()=>new Response('<div id="pane-side"></div><div id="main"><header>Teste</header></div><script>window.WPP={isReady:true,chat:{downloadMedia(){},getActiveChat:async()=>({id:{_serialized:"12025550123@c.us"}})}}</script>',{headers:{'Content-Type':'text/html'}}));
  });
  const base=path.join(__dirname,'../apps/desktop');
  app.setAppPath(base);require(path.join(base,'dist/main/index.bundle.cjs'));
  async function until(fn) {
    for(let i=0;i<150;i++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,100));}
    throw Error('Tempo esgotado no ensaio de glossário');
  }
  const page=tail=>until(()=>webContents.getAllWebContents().find(w=>w.getURL().endsWith(tail)&&!w.isLoading()));
  async function check() {
    const shell=await page('/shell/index.html');
    const invoke=(name,...params)=>shell.executeJavaScript('window.adrShell['+JSON.stringify(name)+'](...'+JSON.stringify(params)+')');
    await invoke('show','settings','traducao');
    let panel;
    await until(async()=>{
      panel=webContents.getAllWebContents().find(w=>w.getURL().includes('/panel.html')&&!w.isLoading());
      if(!panel)await invoke('show','settings','traducao');
      return panel;
    });
    await invoke('show','settings','traducao');
    const ui=expression=>panel.executeJavaScript(expression);
    await until(()=>ui("!document.querySelector('[data-pane=traducao]').classList.contains('hidden')"));
    const terms=async()=>(await invoke('getState')).englishGlossary;
    const setForm=async target=>{
      await ui("document.querySelector('#glossary-source').value='valores';document.querySelector('#glossary-target').value="+JSON.stringify(target)+";document.querySelector('#glossary-form').requestSubmit();");
      await until(async()=>(await terms()).some(t=>t.target===target));
    };
    if(process.argv[2]==='save'){
      assert.deepEqual(await terms(),[]);
      await setForm('contract rates');
      await ui("document.querySelector('#glossary-list button').click()");
      await setForm('agreed rates');
      await invoke('addService','whatsapp','Segunda conta');
    }
    assert.deepEqual(await terms(),[{source:'valores',target:'agreed rates'}]);
    const state=JSON.parse(fs.readFileSync(path.join(profile,'state.v1.json'),'utf8'));
    const accounts=state.services.filter(v=>v.kind==='whatsapp'&&!v.deletedAt);
    assert.equal(accounts.length,2);
    for(const account of accounts){
      await invoke('show','service:'+account.id);
      const partition=session.fromPartition(state.profiles.find(p=>p.id===account.profileId).partitionName);
      const wa=await until(()=>webContents.getAllWebContents().find(w=>w.session===partition && w.getURL().startsWith('https://web.whatsapp.com/') && !w.isLoading()));
      const text=new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{ipcMain.removeListener('fixture:result',listen);reject(Error('Sem tradução'));},15000);
        function listen(event,reply){if(event.sender===wa){clearTimeout(timer);ipcMain.removeListener('fixture:result',listen);resolve(reply);}}
        ipcMain.on('fixture:result',listen);
      });
      wa.send('fixture:check','Você pode me enviar os valores?',account.id===accounts[0].id,process.argv[2]==='save');
      assert.equal(await text,'Could you send me the agreed rates?');
    }
    if(process.argv[2]==='reopen'){
      await invoke('show','settings','traducao');
      await ui("document.querySelector('#glossary-list button:last-child').click()");
      await until(async()=>(await terms()).length===0);
    }
    console.log('Glossário em duas sessões:',process.argv[2],'OK');
  }
  app.whenReady().then(check).then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1)});
}
