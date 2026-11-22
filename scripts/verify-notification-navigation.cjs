// Isolated Electron fixture: no real profiles, accounts, messages or network.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "adr-notification-fixture-")));

app.whenReady().then(async () => {
  let win;
  try {
    const { buildNotificationGuard, openWhatsAppNotificationChatScript, serviceNotificationsOn } =
      await import(
        pathToFileURL(path.resolve(__dirname, "../apps/desktop/dist/main/notifications.js")).href
      );
    const ses = session.fromPartition("notification-fixture");
    ses.protocol.handle(
      "https",
      () =>
        new Response(
          '<html><body><div id="side"></div><div id="pane-side"></div><div id="main"><header></header></div></body></html>',
          { headers: { "Content-Type": "text/html" } },
        ),
    );
    win = new BrowserWindow({
      show: false,
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await win.loadURL("https://web.whatsapp.com/");
    const run = (script) => win.webContents.executeJavaScript(script, true);
    const fixture = async (role, names) =>
      run(`
      document.querySelector('#main header').replaceChildren();
      document.querySelector('#side').replaceChildren();
      window.renderRows = (names) => {
        const pane = document.querySelector('#pane-side'); pane.replaceChildren();
        for (const name of names) {
          const row = document.createElement('div'); row.setAttribute('role', ${JSON.stringify(role)});
          const span = document.createElement('span'); span.title = name; span.textContent = name; row.append(span);
          row.addEventListener('mousedown', () => {
            const heading = document.createElement('span'); heading.title = name;
            document.querySelector('#main header').replaceChildren(heading);
          });
          pane.append(row);
        }
      }; renderRows(${JSON.stringify(names)}); true;
    `);
    for (const role of ["row", "listitem"]) {
      await fixture(role, ["Ana Silva", "Ana"]);
      assert.equal(await run(openWhatsAppNotificationChatScript("Ana | 2 mensagens")), true);
      assert.equal(await run("document.querySelector('#main header span').title"), "Ana");
    }
    await fixture("row", []);
    await run("setTimeout(() => renderRows(['Ana Silva']), 350); true");
    assert.equal(await run(openWhatsAppNotificationChatScript("Ana Silva")), true);
    await fixture("row", []);
    await run(`
      const search = document.createElement('input'); search.type = 'text'; search.setAttribute('aria-label', 'Pesquisar ou começar uma nova conversa');
      search.addEventListener('input', () => renderRows([search.value])); document.querySelector('#side').append(search); true;
    `);
    assert.equal(await run(openWhatsAppNotificationChatScript("Ana Silva")), true);
    await fixture("row", ["Ana Silva"]);
    assert.equal(await run(openWhatsAppNotificationChatScript("Ana")), false);
    assert.equal(await run("document.querySelector('#main header').children.length"), 0);

    await fixture("row", ["Ana Silva"]);
    await run(`
      window.created = [];
      window.Notification = class extends EventTarget {
        static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); }
        constructor(title) { super(); window.created.push(this); } close() {}
      }; true;
    `);
    await run(buildNotificationGuard(JSON.stringify({ enabled: true }), "wa-fixture"));
    let clickMessage;
    win.webContents.on("console-message", ({ message }) => {
      if (message.startsWith("ADR_OPEN_WHATSAPP_CHAT:")) clickMessage = message;
    });
    await run("new Notification('Ana Silva').dispatchEvent(new Event('click')); true");
    assert.deepEqual(JSON.parse(clickMessage.slice("ADR_OPEN_WHATSAPP_CHAT:".length)), {
      serviceId: "wa-fixture",
      title: "Ana Silva",
    });
    assert.equal(
      await run("document.querySelector('#main header').children.length"),
      0,
      "click must wait for main/PIN",
    );
    assert.equal(await run(openWhatsAppNotificationChatScript("Ana Silva")), true);
    assert.equal(
      serviceNotificationsOn({ enabled: true, serviceEnabled: { crm: true } }, "crm"),
      false,
    );
    await run("window.__adrNotifSettings = { enabled: false }; new Notification('CRM'); true");
    assert.equal(await run("window.created.length"), 1);
    console.log(
      "PASS: Electron DOM — row/listitem, mousedown, delayed render, sidebar search, exact name, focus/PIN handoff, CRM blocked.",
    );
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    win?.destroy();
    app.exit(1);
  }
});
