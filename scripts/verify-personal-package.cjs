// Abre exclusivamente o executável Bira local, inspeciona o boot e encerra.
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const binary=path.join(root,'apps/desktop/release/win-unpacked/biraworkspace.exe');
const env={...process.env,BIRA_TEST_HIDDEN:'1'};
delete env.ELECTRON_RUN_AS_NODE;delete env.BIRA_TEST_PROFILE;
let socket,finished=false,sequence=0;
const pending=new Map();
const child=spawn(binary,['--inspect=127.0.0.1:0'],{env,cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
const timeout=setTimeout(()=>fail(Error('Timeout do pacote local')),60000);
function fail(error){if(finished)return;finished=true;console.error(error);clearTimeout(timeout);socket?.close();child.kill();process.exitCode=1;}
function command(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const response=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(response.exceptionDetails)throw Error(JSON.stringify(response.exceptionDetails));return response.result.value;}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const electronExpression="process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json')('electron')";
let stderr='';
child.stderr.on('data',data=>{
 stderr+=data.toString();
 const url=stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[a-z0-9-]+/)?.[0];
 if(!url||socket)return;
 socket=new WebSocket(url);
 socket.onmessage=event=>{const message=JSON.parse(event.data);const waiter=pending.get(message.id);if(waiter){pending.delete(message.id);if(message.error)waiter.reject(Error(message.error.message));else waiter.resolve(message.result);}};
 socket.onopen=async()=>{
  try{
   let result;
   for(let i=0;i<200;i++){
    result=await evaluate(`(async()=>{const e=${electronExpression};if(!e.app.isReady())return null;const shell=e.webContents.getAllWebContents().find(w=>w.getURL().endsWith('/shell/index.html'));if(!shell||shell.isLoading())return null;return {packaged:e.app.isPackaged,name:e.app.getName(),profile:e.app.getPath('userData'),state:await shell.executeJavaScript('window.adrShell.getState()')};})()`);
    if(result)break;await wait(100);
   }
   assert(result,'shell do pacote carregado');assert.equal(result.packaged,true);assert.equal(result.name,'BiraWorkspace');
   assert.equal(path.basename(result.profile),'BiraWorkspace');assert.equal(result.state.personal,true);assert.equal(result.state.update.phase,'disabled');assert(!result.state.rail.includes('crm'));
   fs.writeFileSync(path.join(root,'.test-results/package-runtime.json'),JSON.stringify({passed:true,binary,profile:result.profile,checks:['executável empacotado','identidade Bira','perfil separado','boot sem CRM','updater desligado']},null,2));
   await evaluate(`setTimeout(()=>${electronExpression}.app.quit(),100);true`);
   finished=true;clearTimeout(timeout);socket.close();console.log('PASS: executável BiraWorkspace empacotado');
  }catch(error){fail(error);}
 };
 socket.onerror=()=>fail(Error('Conexão com inspector local falhou'));
});
child.on('error',fail);
child.on('exit',code=>{if(!finished)fail(Error('Pacote encerrou antes da validação: '+code));else if(code!==0)process.exitCode=1;});
