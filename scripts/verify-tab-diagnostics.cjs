const { app, webContents } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {execFileSync} = require("node:child_process");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: wait } = require("node:timers/promises");

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "bira-diagnostics-"));
process.env.BIRA_TEST_PROFILE = profile;
process.env.BIRA_TEST_HIDDEN = "1";
const packagePath = process.argv[2];
app.setAppPath(packagePath ? path.resolve(packagePath) : path.resolve(__dirname, "../apps/desktop"));
app.setPath("downloads", profile);
const adr = "https://app.adragencia.com.br/";
let simulateOffline = false;
app.on("session-created", session => {
  session.protocol.handle("https", request => {
    if (request.url === adr) return simulateOffline ? Response.error() : Response.redirect(adr + "login");
    if (request.url === adr + "app.js") {
      return new Response("document.body.textContent = 'Entrar no ADR';", {
        headers: { "content-type": "application/javascript" },
      });
    }
    return new Response('<!doctype html><body><script src="/app.js"></script></body>', {
      headers: { "content-type": "text/html" },
    });
  });
});
require(path.join(app.getAppPath(), "dist/main/index.bundle.cjs"));

async function findPage(suffix) {
  for (let i = 0; i < 100; i++) {
    const contents = webContents.getAllWebContents().find(w => w.getURL().endsWith(suffix));
    if (contents && !contents.isLoading()) return contents;
    await wait(50);
  }
  throw new Error("Página não abriu: " + suffix);
}

async function verify() {
  const shell = await findPage("/shell/index.html");
  const invoke = (method, ...args) =>
    shell.executeJavaScript(`window.adrShell[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
  await invoke("addService", "browser", "Nome privado de teste");
  const toolbar = await findPage("/browser-toolbar.html");
  await toolbar.executeJavaScript("window.adrBrowser.toggleAdBlock(true)");
  assert.equal(await toolbar.executeJavaScript("window.adrBrowser.getAdBlockState().then(state => state.enabled)"), true);
  const clickAdr = () => toolbar.executeJavaScript(`document.querySelector('#bookmarks button[title="${adr}"]').click()`);
  const verifyLogin = async () => {
    const page = await findPage(adr + "login");
    assert.equal(await page.executeJavaScript("document.body.innerText.trim()"), "Entrar no ADR");
  };
  await clickAdr();
  await verifyLogin();
  simulateOffline = true;
  await clickAdr();
  const retryVisible = "!!document.querySelector('#adr-retry:not([hidden])')?.getBoundingClientRect().width";
  for (let i = 0; i < 100 && !(await toolbar.executeJavaScript(retryVisible)); i++) await wait(50);
  assert(await toolbar.executeJavaScript(retryVisible), "Falha do ADR deve oferecer recuperação visível");
  simulateOffline = false;
  await toolbar.executeJavaScript("document.getElementById('adr-retry').click()");
  await verifyLogin();
  assert.equal(await toolbar.executeJavaScript(retryVisible), false);
  console.log("Favorito ADR passou: bloqueador ligado, login renderizado e recuperação após falha.");
  if (packagePath) {
    const dataDir = process.env.LOCALAPPDATA || path.join(os.homedir(), ".local/share");
    const models = path.join(dataDir, "BiraWorkspace/translation");
    const python = path.join(models, process.platform === "win32" ? "venv/Scripts/python.exe" : "venv/bin/python");
    const worker = path.join(app.getAppPath(), "dist/preload/translate-worker.py");
    execFileSync(python, ["-I", "-X", "utf8", path.join(__dirname, "verify-translation-locale.py"), models], {
      input: fs.readFileSync(worker), stdio: ["pipe", "inherit", "inherit"], windowsHide: true, timeout: 45000,
    });
    return;
  }
  let acceptedLanguage;
  const server = http.createServer((req, res) => {
    acceptedLanguage = req.headers["accept-language"];
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end("<!doctype html><title>Idioma</title>");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const localUrl = `http://127.0.0.1:${server.address().port}/idioma`;
    await toolbar.executeJavaScript(`window.adrBrowser.navigate(${JSON.stringify(localUrl)})`);
    const page = await findPage(localUrl);
    const language = await page.executeJavaScript("navigator.language");
    console.log("Idioma do app, da página e do pedido HTTP:", app.getLocale(), language, acceptedLanguage);
    assert.equal(app.getLocale(), "pt-BR");
    assert.equal(language, "pt-BR");
    assert.equal(acceptedLanguage?.split(",")[0], "pt-BR");
  } finally {
    server.closeAllConnections();
    server.close();
  }
  const failedUrl = 'https://interno.adragencia.com.br/rota-privada?code=segredo-de-teste';
  const failed = new Promise(resolve => {
    for (const contents of webContents.getAllWebContents()) {
      contents.on('did-fail-load', (_event, code, description, url, main) => {
        if (main && url === failedUrl) resolve({ code, description });
      });
    }
  });
  await toolbar.executeJavaScript(`window.adrBrowser.navigate(${JSON.stringify(failedUrl)})`);
  const chromium = await failed;
  const exported = await invoke('exportDiagnostics');
  const reportText = fs.readFileSync(exported.file, 'utf8');
  const report = JSON.parse(reportText);
  assert.equal(report.appLocale, 'pt-BR');
  const blocked = report.tabIncidents.find(e => e.event === 'policy-block' && e.kind === 'browser');
  assert.equal(blocked?.policy, 'adr-domain');
  assert.equal(blocked.destination, 'adragencia.com.br (grupo)');
  assert(report.tabIncidents.some(e => e.viewId === blocked.viewId && e.chromiumCode === chromium.code && e.chromiumError === chromium.description));
  assert.doesNotMatch(reportText, /segredo-de-teste|rota-privada|Nome privado de teste/);
  console.log(`Diagnóstico exportado: ${blocked.policy}, ${chromium.description} (${chromium.code})`);
}
const deadline = setTimeout(() => { console.error("Tempo de verificação esgotado"); app.exit(1); }, 30000);
app.whenReady().then(verify).then(() => { clearTimeout(deadline); app.quit(); })
  .catch(error => { console.error(error); app.exit(1); });
