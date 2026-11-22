const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// Exercita o app real pelo main e pelo DOM, com perfil temporário e sem screenshots.
module.exports = async function verify({ BaseWindow, webContents, untilShell, inShell, wait, shell }) {
  const { MEDIA_ACTIVE_PROBE } = await import(pathToFileURL(path.join(__dirname, "media-probe.mjs")));
  await untilShell();
  const win = BaseWindow.getAllWindows()[0];
  shell().setBackgroundThrottling(false);
  const checks = [];
  const alive = () => webContents.getAllWebContents().filter((contents) => !contents.isDestroyed());
  const toolbar = () => alive().find((contents) => contents.getURL().endsWith("/browser-toolbar.html"));
  const state = () => inShell("window.adrShell.getState()");
  async function until(read, label) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = await read();
      if (value) return value;
      await wait(100);
    }
    throw new Error(`Tempo excedido: ${label}`);
  }
  await until(async () => (await state()).services?.length, "estado inicial");
  assert.equal(alive().some((contents) => contents.getURL().endsWith("/titlebar.html")), false);
  assert.equal(win.contentView.children[0].webContents.id, shell().id);
  checks.push("Título e lateral no mesmo WebContents, sob as views dos serviços");

  win.setMinimumSize(375, 480); // O produto mantém o mínimo de 640; só esta prova testa 375.
  const layouts = [];
  for (const width of [375, 640, 1280]) {
    win.setSize(width, 800);
    await inShell('window.adrShell.updateSettings({ uiScale: 1 })');
    await until(async () => Math.abs(await inShell("innerWidth") - win.getContentBounds().width) <= 1,
      `redimensionamento do shell (${JSON.stringify({ width, bounds: win.getContentBounds(), shell: win.contentView.children[0].getBounds(), zoom: shell().getZoomFactor(), minimized: win.isMinimized() })})`);
    for (const sidebarPosition of ["left", "right", "top", "bottom"]) {
      for (const uiScale of [1, 1.5, 2]) {
        await inShell(`window.adrShell.updateSettings(${JSON.stringify({ sidebarPosition, sidebarExpanded: true, uiScale })})`);
        await wait(200);
        const dom = await inShell(`(() => {
          const rect = (node) => { const r = node.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height }; };
          return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
            rail: rect(document.getElementById("rail")), header: rect(document.getElementById("titlebar")),
            controls: [...document.querySelectorAll("#titlebar button")].map(rect) };
        })()`);
        const { chromeLayout } = await state();
        assert.ok(dom.scrollWidth <= dom.width + 1, `Rolagem da página: ${width}/${sidebarPosition}/${uiScale}: ${JSON.stringify(dom)}`);
        for (const key of ["x", "y", "width", "height"]) {
          assert.ok(Math.abs(dom.rail[key] - chromeLayout.sidebar[key]) <= 2, `Lateral desalinhada: ${key}, ${width}/${sidebarPosition}/${uiScale}: ${JSON.stringify(dom)}`);
        }
        for (const control of dom.controls) {
          assert.ok(control.x >= -1 && control.x + control.width <= dom.width + 1, `Botão fora da janela: ${width}/${uiScale}: ${JSON.stringify(dom)}`);
        }
        layouts.push({ width, sidebarPosition, uiScale });
      }
    }
  }
  checks.push(`${layouts.length} combinações de largura, posição e escala sem desalinhamento ou overflow da página`);
  win.setSize(1280, 800);
  await inShell('window.adrShell.updateSettings({ sidebarPosition: "left", uiScale: 1 })');

  const before = await state();
  const whatsapp = before.services.find((service) => service.kind === "whatsapp");
  await inShell('window.adrShell.addService("browser")');
  const browser = (await state()).services.find((service) => !before.services.some((old) => old.id === service.id) && service.kind === "browser");
  assert.ok(browser);
  const browserView = await until(() => win.contentView.children.find((view) => view.webContents?.getURL().startsWith("https://www.google.com")), "view do Browser");
  const contents = browserView.webContents;
  await contents.loadURL("https://ram-check.example/editor");
  const firstToolbar = await until(toolbar, "primeira barra");
  await contents.executeJavaScript('document.body.innerHTML = \'<div id="editor" contenteditable="true">Documento salvo</div>\'');
  await inShell(`window.adrShell.show("service:${whatsapp.id}")`);
  assert.equal((await contents.executeJavaScript(MEDIA_ACTIVE_PROBE)).active, false);
  assert.equal((await inShell(`window.adrShell.hibernateService(${JSON.stringify(browser.id)})`)).ok, true);
  await until(() => firstToolbar.isDestroyed(), "fechar barra sem serviço carregado");
  checks.push("Conteúdo editável não modificado pode hibernar; barra auxiliar é destruída");

  await inShell(`window.adrShell.show("service:${browser.id}")`);
  const secondToolbar = await until(toolbar, "barra recriada");
  assert.notEqual(secondToolbar.id, firstToolbar.id);
  const reopened = await until(() => alive().find((item) => item.getURL().startsWith("https://ram-check.example/editor") && !item.isLoading()), "Browser reaberto");
  await reopened.executeJavaScript('document.body.innerHTML = \'<div id="editor" contenteditable="true">Documento salvo</div>\'; document.getElementById("editor").focus()');
  await reopened.insertText("rascunho protegido");
  await inShell(`window.adrShell.show("service:${whatsapp.id}")`);
  assert.equal((await reopened.executeJavaScript(MEDIA_ACTIVE_PROBE)).active, true);
  await inShell(`window.adrShell.setHibernateAfter(${JSON.stringify(browser.id)}, 1)`);
  await wait(65_000);
  await inShell('window.adrShell.updateSettings({ maxLoadedViews: 3 })');
  await wait(500);
  assert.equal(reopened.isDestroyed(), false);
  checks.push("Rascunho editável continua protegido após perder o foco");

  const saved = await inShell(`window.adrShell.setHibernateAfter(${JSON.stringify(browser.id)}, 30)`);
  assert.equal(saved.ok, true);
  assert.equal((await state()).services.find((service) => service.id === browser.id).hibernateAfterMinutes, 30);
  for (const invalid of [0, -1, 1.5, 1441, "30"]) {
    assert.equal((await inShell(`window.adrShell.setHibernateAfter(${JSON.stringify(browser.id)}, ${JSON.stringify(invalid)})`)).ok, false);
  }
  await inShell('window.adrShell.show("settings", "servicos")');
  const panel = await until(() => alive().find((item) => item.getURL().endsWith("/panel.html") && !item.isLoading()), "Configurações");
  await until(() => panel.executeJavaScript(`!!document.querySelector('[data-focus-key="${browser.id}:idle"]')`), "seletor de prazo");
  const field = await panel.executeJavaScript(`(() => { const select = document.querySelector('[data-focus-key="${browser.id}:idle"]'); return { value:select.value, label:select.closest("label").textContent }; })()`);
  assert.equal(field.value, "30");
  assert.ok(field.label.includes("Hibernar após ociosidade"));
  assert.equal((await inShell(`window.adrShell.setHibernateAfter(${JSON.stringify(browser.id)}, null)`)).ok, true);
  assert.equal((await state()).services.find((service) => service.id === browser.id).hibernateAfterMinutes, undefined);
  checks.push("Prazo por serviço: campo rotulado, persistência, restauração do padrão e rejeição de valores inválidos");

  const answer = inShell('window.adrShell.askText("Teste de foco", "", "Salvar")');
  const prompt = await until(() => alive().find((item) => item.getURL().includes("/prompt.html?") && !item.isLoading()), "prompt");
  prompt.setBackgroundThrottling(false);
  await until(() => prompt.executeJavaScript('document.activeElement === document.querySelector("input")'), "foco do campo no prompt");
  assert.equal(prompt.isFocused(), true);
  await prompt.insertText("teste de foco");
  assert.equal(await prompt.executeJavaScript('document.querySelector("input").value'), "teste de foco");
  await prompt.executeJavaScript('document.querySelector("button:not(.primary)").click()');
  await answer;
  await until(() => prompt.isDestroyed(), "liberação do prompt");
  checks.push("Prompt recebe texto sem clique e libera o WebContents ao cancelar");

  assert.ok(win.getPosition()[0] < -10000);
  return { ok: true, checks, layouts };
};
