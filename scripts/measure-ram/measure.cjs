// Medição de RAM do ADR Workspace com perfil temporário e CRM simulado em HTTPS local.
// Ferramenta de medição local (não vai para o pacote). Ver scripts/measure-ram/run.sh.
// Uso: electron measure.cjs <seed|run> <perfil> <saida.json> <bundle>
const { app, BaseWindow, webContents } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");

const args = process.argv.slice(process.argv.findIndex((a) => ["seed", "run", "ui", "verify"].includes(a)));
const [mode, profile, outFile, bundle] = args;
const isUi = mode === "ui";
app.setPath("userData", profile);
app.commandLine.appendSwitch("ignore-certificate-errors");
app.commandLine.appendSwitch("host-resolver-rules", "MAP app.adragencia.com.br 127.0.0.1, MAP ram-check.example 127.0.0.1");

// Janela nunca vem para a frente: fora da tela e sem foco.
const proto = BaseWindow.prototype;
proto.show = function () {
  this.setPosition(-30000, -30000);
  this.showInactive();
};
proto.maximize = function () {};
proto.focus = function () {};
proto.restore = function () {};

const server = https.createServer(
  { key: fs.readFileSync(path.join(__dirname, "key.pem")), cert: fs.readFileSync(path.join(__dirname, "cert.pem")) },
  (req, res) => {
    const cookies = [
      "auth_token=fake-token; Path=/; Secure; SameSite=Lax; Max-Age=86400",
      "tenant_id=t1; Path=/; Secure; SameSite=Lax; Max-Age=86400",
    ];
    if (req.url.startsWith("/api") || req.headers.accept?.includes("application/json")) {
      res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": cookies });
      res.end(JSON.stringify({ ok: true, context: { userId: "u1", tenantId: "t1" }, data: [] }));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html", "Set-Cookie": cookies });
    res.end("<!doctype html><title>CRM simulado</title><body>CRM simulado</body>");
  },
);
server.listen(443, "127.0.0.1");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shell = () =>
  webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().endsWith("/shell/index.html"));
const inShell = (code) => shell().executeJavaScript(code, true);

function snap(label) {
  const metrics = app.getAppMetrics();
  const byType = {};
  let privateKb = 0;
  let workingSetKb = 0;
  for (const p of metrics) {
    byType[p.type] = (byType[p.type] || 0) + 1;
    privateKb += p.memory.privateBytes || 0;
    workingSetKb += p.memory.workingSetSize || 0;
  }
  const live = webContents.getAllWebContents().filter((w) => !w.isDestroyed());
  const urls = live.map((w) => w.getURL());
  return {
    label,
    processes: metrics.length,
    byType,
    privateMB: Math.round(privateKb / 1024),
    workingSetMB: Math.round(workingSetKb / 1024),
    webContents: live.length,
    loadedPages: urls.filter((u) => u && u !== "about:blank").length,
    crmPages: urls.filter((u) => u.includes("app.adragencia.com.br")).length,
    shellPages: urls.filter((u) => u.startsWith("file:")).map((u) => path.basename(u.split("?")[0])),
    servicePages: urls.filter((u) => u.startsWith("https:") && !u.includes("app.adragencia.com.br")).length,
  };
}

async function untilShell() {
  for (let i = 0; i < 120; i++) {
    const s = shell();
    if (s && !s.isLoading()) return;
    await wait(500);
  }
  throw new Error("shell não carregou");
}

const clickTile = (suffix, kind) =>
  inShell(`(() => {
    const b = [...document.querySelectorAll("button.tab")].find((n) =>
      (n.getAttribute("aria-label") || "").endsWith(${JSON.stringify(suffix)}) && n.querySelector(".k-${kind}"));
    if (!b) return false; b.click(); return true; })()`);

async function seed() {
  await untilShell();
  await wait(15000);
  await inShell(`window.adrShell.createWorkspace("B")`);
  await wait(15000);
  const state = await inShell(`window.adrShell.getState()`);
  const first = state.workspaces?.[0]?.id;
  if (first) await inShell(`window.adrShell.setWorkspace(${JSON.stringify(first)})`);
  await wait(8000);
}

async function ui() {
  await untilShell();
  await wait(8000);
  const out = [];
  for (const position of ["top", "bottom", "left"]) {
    await inShell(`window.adrShell.updateSettings({ sidebarPosition: ${JSON.stringify(position)}, sidebarExpanded: true })`);
    await wait(2500);
    out.push(
      await inShell(`(() => {
        const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
        const tabs = [...document.querySelectorAll("button.tab, .util, #tab-ws-add, #tab-add")];
        const hidden = tabs.filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.bottom > vh + 1); }).length;
        return { position: ${JSON.stringify(position)}, viewport: vw + "x" + vh, scrollWidth: document.documentElement.scrollWidth, botoes: tabs.length, foraDaTela: hidden };
      })()`),
    );
  }
  return out;
}

async function run() {
  const results = [];
  await untilShell();
  await wait(45000);
  results.push(snap("boot"));

  await inShell(`window.adrShell.show("settings")`);
  await wait(5000);
  const state = await inShell(`window.adrShell.getState()`);
  const wa = state.services.find((s) => s.kind === "whatsapp");
  await inShell(`window.adrShell.show("service:${wa.id}")`);
  await wait(5000);
  results.push(snap("depois de abrir e fechar Configurações"));

  void inShell(`window.adrShell.askText("Teste", "x")`);
  await wait(4000);
  const prompt = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().includes("prompt.html"));
  await prompt?.executeJavaScript(`document.querySelector("button:not(.primary)")?.click()`);
  await wait(4000);
  results.push(snap("depois de abrir e cancelar o prompt"));

  const [nameA, nameB] = state.workspaces.map((w) => w.name);
  const switched = [];
  switched.push(await clickTile("— " + nameB, "whatsapp"));
  await wait(12000);
  switched.push(await clickTile("— " + nameA, "whatsapp"));
  await wait(12000);
  switched.push(await clickTile("— " + nameB, "whatsapp"));
  await wait(12000);
  const r = snap("depois de 3 trocas de workspace");
  r.clicks = switched;
  results.push(r);

  // Volta ao primeiro workspace, teto de 3 abas e 5 serviços novos abertos em sequência.
  const ws = (await inShell(`window.adrShell.getState()`)).workspaces?.[0]?.id;
  await inShell(`window.adrShell.setWorkspace(${JSON.stringify(ws)})`);
  await inShell(`window.adrShell.updateSettings({ maxLoadedViews: 3 })`);
  for (const kind of ["gmail", "chatgpt", "notion", "trello", "claude"]) {
    await inShell(`window.adrShell.addService(${JSON.stringify(kind)})`);
    await wait(6000);
  }
  const after = await inShell(`window.adrShell.getState()`);
  const waA = after.services.find((s) => s.kind === "whatsapp" && s.workspaceId === ws) || wa;
  await inShell(`window.adrShell.show("service:${waA.id}")`);
  results.push(snap("5 serviços abertos (teto 3)"));
  await wait(170000);
  results.push(snap("2min50s depois (teto 3)"));
  return results;
}

app.whenReady().then(async () => {
  try {
    if (mode === "verify") {
      fs.writeFileSync(outFile, JSON.stringify(await require("./verify.cjs")({ app, BaseWindow, webContents, untilShell, inShell, wait, shell }), null, 2));
    } else if (isUi) {
      fs.writeFileSync(outFile, JSON.stringify(await ui(), null, 2));
    } else if (mode === "seed") {
      await seed();
      fs.writeFileSync(outFile, "seeded");
    } else {
      const results = await run();
      fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
    }
  } catch (error) {
    fs.writeFileSync(outFile, JSON.stringify({ error: String(error?.stack || error) }));
    app.exit(1);
    return;
  }
  app.exit(0);
});
require(bundle);
