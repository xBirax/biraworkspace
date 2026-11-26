const { spawn } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const binary = require(path.join(root,'apps/desktop/node_modules/electron'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(binary,process.argv.slice(2),{cwd:root,env,stdio:'inherit',windowsHide:true});
child.on('error',e=>{console.error(e);process.exitCode=1;});
child.on('exit',(code,signal)=>{console.log('Electron terminou:',code,signal);process.exitCode=code===0?0:1;});
