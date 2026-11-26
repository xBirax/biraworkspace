// Execute dentro de uma sessão gráfica de teste, com XDG_CONFIG_HOME isolado.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";

const [binary,platform,phase]=process.argv.slice(2);
const profile=process.env.XDG_CONFIG_HOME;
assert(profile && fs.existsSync(path.join(profile,".bira-test-profile")),"Perfil de teste obrigatório");
assert(["x11","wayland"].includes(platform) && ["seed","reopen","backup","restore"].includes(phase));
const store=process.env.BIRA_TEST_PASSWORD_STORE || "gnome-libsecret";
assert(["gnome-libsecret","basic"].includes(store));
const started = performance.now();
const logPath = path.join(profile, "electron-"+Date.now()+".log");
const logFd = fs.openSync(logPath, "wx", 0o600);
const child=spawn(binary,["--inspect=127.0.0.1:0","--ozone-platform="+platform,"--password-store="+store],{stdio:["ignore","ignore",logFd]});
fs.closeSync(logFd);
const exited=once(child,"exit");
let output="", socket;

async function waitFor(fn) {
  for(let i=0;i<250;i++) {
    output=fs.readFileSync(logPath,"utf8").slice(-16000);
    if(child.exitCode!==null || child.signalCode) throw Error("Aplicativo encerrou: "+output.slice(-2000));
    const value=await fn();
    if(value)return value;
    await delay(200);
  }
  throw Error("Tempo esgotado: "+output.slice(-2000));
}
try {
  const endpoint=await waitFor(()=>output.match(/ws:\/\/127\.0\.0\.1:\d+\/[\w-]+/)?.[0]);
  // Electron publishes its inspector before the browser process has initialized its modules.
  await delay(1500);
  socket=new WebSocket(endpoint);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let seq=0;
  async function inspect(body) {
    const id=++seq;
    const received=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error("Inspetor não respondeu: "+output.slice(-1700))),8000);
      const listener=({data})=>{
        const message=JSON.parse(data);if(message.id!==id)return;
        clearTimeout(timer);
        socket.removeEventListener("message",listener);
        if(message.result?.exceptionDetails||message.error)reject(Error(message.result?.exceptionDetails?.exception?.description || message.error?.message || "Falha ao inspecionar o pacote"));
        else resolve(message.result.result.value);
      };
      socket.addEventListener("message",listener);
    });
    const expression="(async()=>{const e=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json')('electron');"+body+"})()";
    socket.send(JSON.stringify({id,method:"Runtime.evaluate",params:{expression,awaitPromise:true,returnByValue:true}}));
    try {return await received;} catch(error) {
      if (error.message.includes("Cannot find module 'electron'") || error.message.includes("createRequire is not a function")) return false;
      throw error;
    }
  }
  const shell="if (!e.app.isReady()) return false;const w=e.webContents.getAllWebContents().find(v=>v.getURL().endsWith('/shell/index.html') && !v.isLoading());";
  try {await waitFor(()=>inspect(shell+"return !!w && e.BaseWindow.getAllWindows().some(win=>win.isVisible());"));}
  catch(error){
    console.error(await inspect("return {windows:e.BaseWindow.getAllWindows().map(w=>w.isVisible()),views:e.webContents.getAllWebContents().map(w=>({local:w.getURL().split('/').pop()?.split('?')[0],loading:w.isLoading()}))}"));
    throw error;
  }
  const readyMs = Math.round(performance.now() - started);
  const data=await inspect("return {profile:e.app.getPath('userData'),backend:e.safeStorage.getSelectedStorageBackend(),desktop:e.app.getName(),platform:e.app.commandLine.getSwitchValue('ozone-platform')}");
  assert.equal(data.profile,path.join(profile,"BiraWorkspace"));assert.equal(data.platform,platform);
  if (store === "gnome-libsecret") {
    assert.equal(data.backend, "gnome_libsecret");
    const proof = await inspect(`const fs=process.getBuiltinModule("fs");
      const file=e.app.getPath("userData")+"/keyring-fixture.bin";
      if (${phase === "seed"}) fs.writeFileSync(file,e.safeStorage.encryptString("teste-sintético"));
      const values=[];
      for (const id of ["a","b"]) {
        const jar=e.session.fromPartition("persist:aceite-"+id).cookies;
        const url="https://fixture.invalid";
        if (${phase === "seed"}) {
          await jar.set({url,name:"particao",value:id,expirationDate:Date.now()/1000+86400});
          await jar.flushStore();
        }
        values.push((await jar.get({url,name:"particao"}))[0]?.value);
      }
      return [e.safeStorage.decryptString(fs.readFileSync(file)),...values]`);
    assert.deepEqual(proof,["teste-sintético","a","b"]);
  }
  if(store==="basic"){
    assert.equal(data.backend,"basic_text");
    const rejected=await inspect(shell+"return w.executeJavaScript(\"(async()=>{const a=window.adrShell;const s=await a.getState();const wa=s.services.find(v=>v.kind==='whatsapp');return a.enableWhatsAppLock(wa.id)})()\")");
    assert.equal(rejected.ok,false);assert.match(rejected.message,/chaveiro/i);
  }
  if (phase === "backup" || phase === "restore") {
    const root = data.profile + " Backups";
    const stateFile = path.join(root, "backup-status.json");
    const previous = fs.existsSync(stateFile) ? fs.readFileSync(stateFile, "utf8") : "";
    if (phase === "restore") {
      await inspect(shell + "return w.executeJavaScript(\"window.adrShell.renameWorkspace('Preferência após a cópia')\")");
    }
    const operation = phase === "backup" ? "return a.backupProfile()" :
      "const [copy] = await a.listBackups(); return a.restoreProfile(copy.name)";
    const click = "(async()=>{const a=window.adrShell;" + operation + "})()";
    await inspect(shell + "e.dialog.showMessageBox=async()=>({response:1});setTimeout(()=>w.executeJavaScript(" +
      JSON.stringify(click) + "),100);return true");
    socket.close();
    const [code] = await Promise.race([exited,delay(20000,null,{ref:false}).then(()=>{throw Error("O aplicativo não fechou para a cópia");})]);
    assert.equal(code,0);
    let status;
    for (let i=0;i<400;i++) {
      if (fs.existsSync(stateFile)) {
        const raw = fs.readFileSync(stateFile,"utf8");
        if (raw !== previous) {
          status=JSON.parse(raw);
          if (status.state !== "running") break;
        }
      }
      await delay(100);
    }
    assert.equal(status?.state,"done",status?.message);
    assert.equal(status.label,phase === "backup" ? "manual" : "restore");
    console.log(JSON.stringify({phase, state:status.state, profile:data.profile}));
  } else {
  if(phase==="seed")await inspect(shell+"return w.executeJavaScript(\"window.adrShell.renameWorkspace('Aceite Ubuntu')\")");
  const info=await inspect(shell+"return w.executeJavaScript(\"window.adrShell.getState().then(s=>({persisted:s.workspaces.some(w=>w.name==='Aceite Ubuntu'),build:s.buildId,backup:s.backupAvailable}))\")");
  assert(info.persisted && /^[0-9a-f]{16}$/.test(info.build) && info.backup===(process.env.BIRA_TEST_PREVIOUS !== "1"));
  const metrics = {readyMs};
  if (process.env.BIRA_TEST_BENCH === "1") {
    const script = `(async () => {
      const api = window.adrShell;
      const state = await api.getState();
      const a = state.workspaces[0];
      let b = state.workspaces.find(w => w.name === "Bench 2");
      if (!b) {
        await api.createWorkspace("Bench 2", "#3465a4");
        b = (await api.getState()).workspaces.find(w => w.name === "Bench 2");
      }
      const switches = [];
      for (const item of [b,a,b,a]) {
        const start = performance.now();
        await api.setWorkspace(item.id);
        switches.push(Math.round(performance.now()-start));
      }
      return switches;
    })()`;
    metrics.switchMs = await inspect(shell + "return w.executeJavaScript(" + JSON.stringify(script) + ")");
    await delay(3000);
    metrics.pssMiB = await inspect("const fs=process.getBuiltinModule('fs');let kb=0;for(const p of e.app.getAppMetrics()){try{kb+=Number(fs.readFileSync('/proc/'+p.pid+'/smaps_rollup','utf8').match(/^Pss:\\s+(\\d+)/m)[1])}catch{}}return Math.round(kb/1024)");
  }
  console.log(JSON.stringify({...metrics,package:path.basename(binary),platform,phase,...info,backend:data.backend}));
  await inspect("setTimeout(()=>e.app.quit(),300);return true");
  socket.close();
  const [code]=await Promise.race([exited,delay(15000,null,{ref:false}).then(()=>{throw Error("Falha ao fechar")})]);
  assert.equal(code,0);
  }
} finally {socket?.close();if(child.exitCode===null && !child.signalCode)child.kill();}
