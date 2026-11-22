// UI fixture only: simulated state and IPC, never opens real accounts.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "adr-settings-preview-"));
const root = path.resolve(__dirname, "..");
const desktopVersion = JSON.parse(fs.readFileSync(path.join(root, "apps/desktop/package.json"), "utf8")).version;
app.setPath("userData", temp);
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      width: 1280,
      height: 1120,
      show: true,
      webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
    });
    const errors = [];
    win.webContents.on("console-message", ({ level, message }) => {
      if (level === "error") errors.push(message);
    });
    await win.loadFile(path.join(root, "apps/desktop/dist/shell/panel.html"));
    await win.webContents.executeJavaScript(`
    window.calls=[];
    window.adrShell=new Proxy({}, {get:(_,key)=>(...args)=>{
      if (key === 'then') return undefined;
      calls.push({key,args:args.map((arg)=>typeof arg==='function'?'[callback]':arg)});
      if(key==='optimizerGetSnapshot') return Promise.resolve({
        id:'fixture',createdAt:new Date().toISOString(),incomplete:false,warnings:[],
        overview:{cpuPercent:12,memoryUsedBytes:8*1024**3,memoryTotalBytes:16*1024**3,appMemoryBytes:620*1024**2,diskFreeBytes:120*1024**3,diskTotalBytes:500*1024**3,startupCount:4,activePowerScheme:'Plano existente',sampledAt:new Date().toISOString(),workspace:{loadedViews:4,maxLoadedViews:6}},
        recommendations:[{id:'workspace:hibernate',title:'Suspender abas inativas',description:'Abas elegíveis voltam quando abertas.',category:'workspace',reversible:false,requiresAdmin:false,status:'available'}],
        cleanup:[{id:'cleanup:user-temp',title:'Temporários antigos',description:'Somente arquivos elegíveis do Temp.',category:'cleanup',reversible:false,requiresAdmin:false,status:'available',estimatedBytes:300*1024**2}]
      });
      if(key==='optimizerPreview') return Promise.resolve({id:'synthetic-preview',snapshotId:'fixture',createdAt:new Date().toISOString(),actions:[{id:'cleanup:user-temp',title:'Temporários antigos',category:'cleanup',reversible:false}],warnings:['Exclusão definitiva, sem desfazer.'],irreversible:true});
      if(key==='optimizerHistory') return Promise.resolve([]);
      return Promise.resolve({ok:true});
    }});
    apply({platform:'win32',activeWorkspaceId:'demo',workspaces:[{id:'demo',name:'Principal'}],theme:'dark',uiScale:1,maxLoadedViews:6,autostart:true,update:{currentVersion:'${desktopVersion}',message:'O ADR Workspace está atualizado',phase:'idle'},services:[{id:'wa1',kind:'whatsapp',name:'WhatsApp Comercial',keepAwake:true},{id:'gmail',kind:'gmail',name:'Gmail ADR'}],catalog:[{kind:'whatsapp',name:'WhatsApp',available:true},{kind:'gmail',name:'Gmail',available:true},{kind:'calendar',name:'Calendar',available:true}],whatsappLock:{services:[{id:'wa1',enabled:true,locked:false,timeoutMinutes:45}]},googleAccounts:[],notifications:{enabled:true,respectWhatsAppMute:true,trayBadge:true,quietHours:false,serviceEnabled:{}}});
  `);
    await new Promise((r) => setTimeout(r, 500));
    for (const theme of ["dark", "light"]) {
      await win.webContents.executeJavaScript(
        `apply({theme:'${theme}',uiScale:1});setTab('geral')`,
      );
      await new Promise((r) => setTimeout(r, 250));
      fs.writeFileSync(
        path.join(temp, "settings-" + theme + ".png"),
        (await win.webContents.capturePage()).toPNG(),
      );
    }
    const measurements = [];
    for (const width of [1280, 800]) {
      win.setSize(width, 1120);
      for (const scale of [0.8, 1, 2]) {
        for (const theme of ["dark", "light"])
          for (const tab of ["geral", "servicos", "tema", "perfil", "notif", "privacidade", "desempenho"]) {
            const result = await win.webContents.executeJavaScript(
              `apply({uiScale:${scale},theme:'${theme}'});setTab('${tab}');({theme:'${theme}',width:${width},scale:${scale},tab:'${tab}',overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2||el('main').scrollWidth>el('main').clientWidth+2})`,
            );
            measurements.push(result);
          }
      }
    }
    win.setSize(1280, 1120);
    await win.webContents.executeJavaScript(`apply({uiScale:1,theme:'dark'});setTab('tema')`);
    await new Promise((r) => setTimeout(r, 250));
    fs.writeFileSync(
      path.join(temp, "settings-appearance.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await win.webContents.executeJavaScript(`apply({uiScale:1,theme:'dark'});document.querySelector('nav button[data-tab="desempenho"]').click()`);
    await new Promise((r) => setTimeout(r, 250));
    fs.writeFileSync(
      path.join(temp, "settings-performance.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await win.webContents.executeJavaScript(
      "setTab('geral');document.querySelector('nav button[data-tab=privacidade]').focus()",
    );
    win.focus();
    win.webContents.focus();
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
    const keyboard = await win.webContents.executeJavaScript(
      `new Promise((resolve) => {
        const deadline = performance.now() + 1000;
        const inspect = () => {
          const active = document.activeElement;
          if (active.id === 'ws-name' || performance.now() >= deadline) {
            resolve({field: active.id, visible: active.matches(':focus-visible')});
          } else setTimeout(inspect, 20);
        };
        inspect();
      })`,
    );
    await win.webContents.executeJavaScript(`document.querySelector('nav button[data-tab="desempenho"]').click();document.querySelector('[data-performance-tab="cleanup"]').click();document.querySelector('[data-performance-choice="cleanup:user-temp"]').click();document.getElementById('performance-preview-button').click()`);
    await new Promise((r) => setTimeout(r, 100));
    const cleanupSafety = await win.webContents.executeJavaScript(`(() => {
      const confirmation=document.getElementById('performance-cleanup-confirm');
      const apply=document.getElementById('performance-apply');
      const before=apply.disabled && !confirmation.checked;
      confirmation.click();
      return {before,after:!apply.disabled,previewVisible:!document.getElementById('performance-preview').hidden};
    })()`);
    const controls = await win.webContents.executeJavaScript(`
    setTab('geral');el('ui-scale').value='150';el('ui-scale').dispatchEvent(new Event('change'));
    el('autostart').click();el('btn-diag').click();el('btn-update').click();
    document.querySelector('[data-theme="light"].theme-card').click();
    ({calls,scaleCorrect:calls.some(c=>c.key==='updateSettings'&&c.args[0].uiScale===1.5),tabs:document.querySelectorAll('nav button[aria-current="page"]').length})
  `);
    const crmNotificationsBlocked = await win.webContents.executeJavaScript(`(() => {
      setTab('notif');
      const checkbox = document.querySelector('input[data-focus-key="notification:crm"]');
      return Boolean(checkbox && checkbox.disabled && !checkbox.checked);
    })()`);
    const result = { measurements, controls, keyboard, cleanupSafety, crmNotificationsBlocked, errors };
    fs.writeFileSync(path.join(temp, "result.json"), JSON.stringify(result, null, 2));
    console.log(
      JSON.stringify({
        scenarios: measurements.length,
        overflows: measurements.filter((m) => m.overflow),
        controls,
        keyboard,
        cleanupSafety,
        crmNotificationsBlocked,
        errors,
        artifacts: temp,
      }),
    );
    app.exit(
      errors.length ||
        measurements.some((m) => m.overflow) ||
        !controls.scaleCorrect ||
        !cleanupSafety.before || !cleanupSafety.after || !cleanupSafety.previewVisible ||
        keyboard.field !== "ws-name" ||
        !keyboard.visible ||
        !crmNotificationsBlocked
        ? 1
        : 0,
    );
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
setTimeout(() => app.exit(2), 90000).unref();
