// The local Windows build skips signing/editing in electron-builder because its
// Darwin signing-tool archive needs symlink privileges on this PC. Apply the
// Windows icon/version resources directly, preserving the ASAR resources.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
exports.default = async context => {
  if (context.electronPlatformName !== 'win32') return;
  const cache = path.join(process.env.LOCALAPPDATA,'electron-builder','Cache','winCodeSign');
  const tool = fs.existsSync(cache) && fs.readdirSync(cache)
    .map(dir=>path.join(cache,dir,'rcedit-x64.exe')).find(file=>fs.existsSync(file));
  if (!tool) throw Error('rcedit do electron-builder não encontrado; não gerar pacote com ícone padrão.');
  execFileSync(tool,[path.join(context.appOutDir,'biraworkspace.exe'),
    '--set-icon',path.resolve(__dirname,'../build/icon.ico'),
    '--set-version-string','ProductName','BiraWorkspace',
    '--set-version-string','FileDescription','BiraWorkspace',
    '--set-version-string','OriginalFilename','biraworkspace.exe'],{windowsHide:true,stdio:'pipe'});
  console.log('  • ícone e identificação Bira aplicados ao executável');
  const root = path.resolve(__dirname, '../../..');
  // Exercita também HTML e preloads do ASAR que vai entrar no pacote.
  execFileSync(process.execPath, [
    path.join(root, 'scripts/run-electron-test.cjs'),
    path.join(root, 'scripts/verify-tab-diagnostics.cjs'),
    path.join(context.appOutDir, 'resources/app.asar'),
  ], {cwd: root, stdio: 'inherit', windowsHide: true, timeout: 60000});
};
