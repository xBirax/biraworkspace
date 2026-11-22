const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("adrBrowser", {
  navigate: (input, completeWww) =>
    ipcRenderer.invoke("browser:navigate", input, Boolean(completeWww)),
  focusPage: () => ipcRenderer.invoke("browser:focus-page"),
  zoomReset: () => ipcRenderer.invoke("browser:zoom-reset"),
  tabMenu: (id) => ipcRenderer.invoke("browser:tab-menu", String(id || "")),
  tabMute: (id) => ipcRenderer.invoke("browser:tab-mute", String(id || "")),
  back: () => ipcRenderer.invoke("browser:back"),
  forward: () => ipcRenderer.invoke("browser:forward"),
  reload: (hard) => ipcRenderer.invoke("browser:reload", Boolean(hard)),
  stop: () => ipcRenderer.invoke("browser:stop"),
  find: (text, forward, newSearch) =>
    ipcRenderer.invoke("browser:find", String(text || ""), Boolean(forward), Boolean(newSearch)),
  findStop: () => ipcRenderer.invoke("browser:find-stop"),
  activateTab: (id) => ipcRenderer.invoke("browser:tab-activate", String(id || "")),
  closeTab: (id) => ipcRenderer.invoke("browser:tab-close", String(id || "")),
  newTab: () => ipcRenderer.invoke("browser:tab-new"),
  reorderTabs: (ids) =>
    ipcRenderer.invoke("browser:tabs-reorder", Array.isArray(ids) ? ids.map((id) => String(id)) : []),
  openExternal: () => ipcRenderer.invoke("browser:open-external"),
  lushaSearch: () => ipcRenderer.invoke("browser:lusha-search"),
  getUrl: () => ipcRenderer.invoke("browser:get-url"),
  getAppearance: () => ipcRenderer.invoke("browser:get-appearance"),
  getAdBlockState: () => ipcRenderer.invoke("browser:get-adblock-state"),
  toggleAdBlock: (enabled) => ipcRenderer.invoke("browser:toggle-adblock", enabled),
  toggleSiteAllowlist: () => ipcRenderer.invoke("browser:toggle-site-allowlist"),
  getVaultState: () => ipcRenderer.invoke("browser:get-vault-state"),
  openVaultMenu: () => ipcRenderer.invoke("browser:vault-menu"),
  onUrl: (handler) => {
    const listener = (_e, url) => handler(url);
    ipcRenderer.on("browser:url", listener);
    return () => ipcRenderer.removeListener("browser:url", listener);
  },
  onAppearance: (handler) => {
    const listener = (_e, appearance) => handler(appearance);
    ipcRenderer.on("browser:appearance", listener);
    return () => ipcRenderer.removeListener("browser:appearance", listener);
  },
  onNavState: (handler) => {
    const listener = (_e, state) => handler(state);
    ipcRenderer.on("browser:nav", listener);
    return () => ipcRenderer.removeListener("browser:nav", listener);
  },
  onAdBlockState: (handler) => {
    const listener = (_e, state) => handler(state);
    ipcRenderer.on("browser:adblock", listener);
    return () => ipcRenderer.removeListener("browser:adblock", listener);
  },
  onVaultState: (handler) => {
    const listener = (_e, state) => handler(state);
    ipcRenderer.on("browser:vault", listener);
    return () => ipcRenderer.removeListener("browser:vault", listener);
  },
  onLoading: (handler) => {
    const listener = (_e, loading) => handler(Boolean(loading));
    ipcRenderer.on("browser:loading", listener);
    return () => ipcRenderer.removeListener("browser:loading", listener);
  },
  onFavicon: (handler) => {
    const listener = (_e, url) => handler(typeof url === "string" ? url : null);
    ipcRenderer.on("browser:favicon", listener);
    return () => ipcRenderer.removeListener("browser:favicon", listener);
  },
  onTabs: (handler) => {
    const listener = (_e, strip) => handler(strip);
    ipcRenderer.on("browser:tabs", listener);
    return () => ipcRenderer.removeListener("browser:tabs", listener);
  },
  onFindOpen: (handler) => {
    const listener = (_e, seed) => handler(typeof seed === "string" ? seed : "");
    ipcRenderer.on("browser:find-open", listener);
    return () => ipcRenderer.removeListener("browser:find-open", listener);
  },
  onFindStep: (handler) => {
    const listener = (_e, forward) => handler(Boolean(forward));
    ipcRenderer.on("browser:find-step", listener);
    return () => ipcRenderer.removeListener("browser:find-step", listener);
  },
  onZoom: (handler) => {
    const listener = (_e, percent) => handler(Number(percent) || 100);
    ipcRenderer.on("browser:zoom", listener);
    return () => ipcRenderer.removeListener("browser:zoom", listener);
  },
  onToggleBookmark: (handler) => {
    const listener = () => handler();
    ipcRenderer.on("browser:toggle-bookmark", listener);
    return () => ipcRenderer.removeListener("browser:toggle-bookmark", listener);
  },
  onFindClose: (handler) => {
    const listener = () => handler();
    ipcRenderer.on("browser:find-close", listener);
    return () => ipcRenderer.removeListener("browser:find-close", listener);
  },
  onFindResult: (handler) => {
    const listener = (_e, result) => handler(result);
    ipcRenderer.on("browser:find-result", listener);
    return () => ipcRenderer.removeListener("browser:find-result", listener);
  },
});
