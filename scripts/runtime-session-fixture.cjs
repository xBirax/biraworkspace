// CI only. Synthetic data in a supplied temporary profile, never real accounts.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const argumentStart = process.argv.findIndex((value) => value === "seed" || value === "verify");
const [mode, profile, backupModule] = process.argv.slice(argumentStart);
if (
  !["seed", "verify"].includes(mode) ||
  !profile ||
  !path.isAbsolute(profile) ||
  !profile.includes("adr-runtime-upgrade-")
)
  process.exit(2);
app.setName("ADR Session Fixture");
app.setPath("userData", profile);
app.setPath("sessionData", profile);
app.whenReady().then(async () => {
  try {
    const keeper = new BrowserWindow({ show: false });
    if (mode === "seed") {
      fs.writeFileSync(path.join(profile, "state.v1.json"), "fixture-state");
    }
    const portFile = path.join(profile, "fixture-port.txt");
    const port = mode === "seed" ? 0 : Number(fs.readFileSync(portFile, "utf8"));
    const server = http.createServer((request, response) => {
      if (request.url === "/user-agent") {
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end(request.headers["user-agent"] || "");
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end("<!doctype html><title>Fixture</title>");
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    const actualPort = server.address().port;
    if (mode === "seed") fs.writeFileSync(portFile, String(actualPort));
    for (const name of ["wa-fixture", "crm-fixture", "google-fixture"]) {
      const ses = session.fromPartition(`persist:${name}`);
      let whatsappUa;
      if (mode === "verify") {
        const { configureSessionUserAgent } = await import(
          pathToFileURL(path.join(path.dirname(backupModule), "whatsapp-user-agent.js")).href
        );
        whatsappUa = configureSessionUserAgent(name === "wa-fixture" ? "whatsapp" : "gmail", ses);
      }
      const win = new BrowserWindow({
        show: false,
        webPreferences: {
          session: ses,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      if (whatsappUa) win.webContents.setUserAgent(whatsappUa);
      await win.loadURL(`http://127.0.0.1:${actualPort}/`);
      if (mode === "seed") {
        await ses.cookies.set({
          url: "https://fixture.example.invalid/",
          name: "fixture_session",
          value: name,
          expirationDate: Date.now() / 1000 + 86400,
          secure: true,
          httpOnly: true,
        });
        await win.webContents.executeJavaScript("localStorage.setItem('fixture', 'retained')");
      } else {
        const cookies = await ses.cookies.get({ name: "fixture_session" });
        if (!cookies.some((cookie) => cookie.value === name))
          throw new Error(`Cookie missing: ${name}`);
        if (
          (await win.webContents.executeJavaScript("localStorage.getItem('fixture')")) !==
          "retained"
        )
          throw new Error(`Storage missing: ${name}`);
        const identities = await win.webContents.executeJavaScript(`(async () => {
          const worker = await new Promise((resolve, reject) => {
            const url = URL.createObjectURL(new Blob(['postMessage(navigator.userAgent)'], {type:'text/javascript'}));
            const w = new Worker(url);
            w.onmessage = e => { w.terminate(); URL.revokeObjectURL(url); resolve(e.data); };
            w.onerror = reject;
          });
          return [navigator.userAgent, await (await fetch('/user-agent')).text(), worker];
        })()`);
        for (const identity of [
          ses.getUserAgent(),
          win.webContents.getUserAgent(),
          ...identities,
        ]) {
          if (!identity.includes("Chrome/" + process.versions.chrome))
            throw new Error(`Actual Chromium identity missing: ${name}`);
          if (
            name === "wa-fixture"
              ? /(?:Electron|ADRWorkspace)\//.test(identity)
              : !identity.includes("Electron/44.1.0")
          )
            throw new Error(`Service identity mismatch: ${name}`);
        }
      }
      ses.flushStorageData();
      await ses.cookies.flushStore();
      win.destroy();
    }
    fs.writeFileSync(
      path.join(profile, `${mode}-result.json`),
      JSON.stringify({
        mode,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        partitions: 3,
        identityIsolation: mode === "verify",
        ok: true,
      }),
    );
    server.close();
    keeper.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
