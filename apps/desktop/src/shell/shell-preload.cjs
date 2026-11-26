const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("adrShell", {
  editEnglishTerm: (source,target) => ipcRenderer.invoke("shell:edit-english-term",source,target),
  setTranslation: (id, incoming) => ipcRenderer.invoke('shell:set-translation', id, incoming),
  setAudioLanguage: (id,language)=>ipcRenderer.invoke('shell:audio-language',id,language),
  setTranscription: (id, enabled) => ipcRenderer.invoke('shell:set-transcription', id, enabled),
  setPrivacy: (id,mode) => ipcRenderer.invoke("shell:set-privacy",id,mode),
  hideAll: () => ipcRenderer.invoke("shell:hide-all"),
  moveService: (id,workspaceId) => ipcRenderer.invoke("shell:move-service",id,workspaceId),
  restorePrivacy: id => ipcRenderer.invoke("shell:restore-privacy",id),
  privacyPanel: (open) => ipcRenderer.invoke("shell:privacy-panel",open),
  privacyOptions: (id,options) => ipcRenderer.invoke("shell:privacy-options",id,options),
  show: (surface, panelTab) => ipcRenderer.invoke("shell:show", surface, panelTab),
  reload: (hard) => ipcRenderer.invoke("shell:reload", Boolean(hard)),
  getState: () => ipcRenderer.invoke("shell:get-state"),
  addService: (kind, name, newGoogleAccount) =>
    ipcRenderer.invoke("shell:add-service", kind, name, newGoogleAccount),
  renameGoogleAccount: (profileId, name) =>
    ipcRenderer.invoke("shell:rename-google-account", profileId, name),
  setServiceGoogleAccount: (serviceId, profileId) =>
    ipcRenderer.invoke("shell:set-service-google-account", serviceId, profileId),
  renameMicrosoftAccount: (profileId, name) =>
    ipcRenderer.invoke("shell:rename-microsoft-account", profileId, name),
  setServiceMicrosoftAccount: (serviceId, profileId) =>
    ipcRenderer.invoke("shell:set-service-microsoft-account", serviceId, profileId),
  microsoftLogout: (profileId) => ipcRenderer.invoke("shell:microsoft-logout", profileId),
  renameService: (id, name) => ipcRenderer.invoke("shell:rename-service", id, name),
  removeService: (id) => ipcRenderer.invoke("shell:remove-service", id),
  setKeepAwake: (id, keep) => ipcRenderer.invoke("shell:set-keep-awake", id, keep),
  setHibernateAfter: (id, minutes) => ipcRenderer.invoke("shell:set-hibernate-after", id, minutes),
  hibernateService: (id) => ipcRenderer.invoke("shell:hibernate-service", id),
  serviceContextMenu: (id) => ipcRenderer.invoke("shell:service-context-menu", id),
  renameWorkspace: (name) => ipcRenderer.invoke("shell:rename-workspace", name),
  setAutostart: (enabled) => ipcRenderer.invoke("shell:set-autostart", enabled),
  windowControl: (action) => ipcRenderer.invoke("shell:window", action),
  openPalette: () => ipcRenderer.invoke("shell:open-palette"),
  closePalette: () => ipcRenderer.invoke("shell:close-palette"),
  toastBounds: (width, height) => ipcRenderer.invoke("shell:toast-bounds", width, height),
  toggleNotifPanel: () => ipcRenderer.invoke("shell:toggle-notif-panel"),
  clearNotifications: () => ipcRenderer.invoke("shell:clear-notifications"),
  googleLogout: (profileId) => ipcRenderer.invoke("shell:google-logout", profileId),
  setContactsAccount: (email) => ipcRenderer.invoke("shell:set-contacts-account", email),
  reorderServices: (orderedIds) => ipcRenderer.invoke("shell:reorder-services", orderedIds),
  reorderWorkspaces: (orderedIds) => ipcRenderer.invoke("shell:reorder-workspaces", orderedIds),
  setWorkspace: (id, surface) => ipcRenderer.invoke("shell:set-workspace", id, surface),
  createWorkspace: (name, color) => ipcRenderer.invoke("shell:create-workspace", name, color),
  askText: (title, initial, okLabel) =>
    ipcRenderer.invoke("shell:ask-text", title, initial, okLabel),
  confirm: (message, okLabel, detail) =>
    ipcRenderer.invoke("shell:confirm", message, okLabel, detail),
  setCrmMuted: (muted) => ipcRenderer.invoke("shell:set-crm-muted", muted),
  enableWhatsAppLock: (serviceId) => ipcRenderer.invoke("shell:enable-whatsapp-lock", serviceId),
  disableWhatsAppLock: (serviceId) => ipcRenderer.invoke("shell:disable-whatsapp-lock", serviceId),
  changeWhatsAppPin: (serviceId) => ipcRenderer.invoke("shell:change-whatsapp-pin", serviceId),
  setWhatsAppLockOnLeave: (serviceId, onLeave) =>
    ipcRenderer.invoke("shell:set-whatsapp-lock-on-leave", serviceId, onLeave),
  setWhatsAppLockTimeout: (serviceId, minutes) =>
    ipcRenderer.invoke("shell:set-whatsapp-lock-timeout", serviceId, minutes),
  lockWhatsApp: (serviceId) => ipcRenderer.invoke("shell:lock-whatsapp", serviceId),
  crmContextMenu: () => ipcRenderer.invoke("shell:crm-context-menu"),
  updateNotifications: (patch) => ipcRenderer.invoke("shell:update-notifications", patch || {}),
  updateSettings: (patch) => ipcRenderer.invoke("shell:update-settings", patch || {}),
  setCalendarFeed: (url) => ipcRenderer.invoke("shell:set-calendar-feed", String(url || "")),
  listPermissionGrants: () => ipcRenderer.invoke("shell:list-permission-grants"),
  revokePermissionGrant: (key) => ipcRenderer.invoke("shell:revoke-permission-grant", String(key || "")),
  restoreProfile: (name) => ipcRenderer.invoke("shell:restore-profile", name),
  listBackups: () => ipcRenderer.invoke("shell:list-backups"),
  openBackups: () => ipcRenderer.invoke("shell:open-backups"),
  backupProfile: () => ipcRenderer.invoke("shell:backup-profile"),
  cancelDownload: (id) => ipcRenderer.invoke("shell:download-cancel", id),
  openExternalBrowser: (url, prefer) =>
    ipcRenderer.invoke("shell:open-external-browser", url, prefer),
  exportDiagnostics: () => ipcRenderer.invoke("shell:export-diagnostics"),
  optimizerAnalyze: () => ipcRenderer.invoke("shell:optimizer-analyze"),
  optimizerGetSnapshot: () => ipcRenderer.invoke("shell:optimizer-snapshot"),
  optimizerPreview: (ids) => ipcRenderer.invoke("shell:optimizer-preview", ids),
  optimizerApply: (previewId, cleanupConfirmed) =>
    ipcRenderer.invoke("shell:optimizer-apply", previewId, Boolean(cleanupConfirmed)),
  optimizerGetRun: (id) => ipcRenderer.invoke("shell:optimizer-run", id),
  optimizerCancel: (id) => ipcRenderer.invoke("shell:optimizer-cancel", id),
  optimizerRestore: (runId, actionId) =>
    ipcRenderer.invoke("shell:optimizer-restore", runId, actionId),
  optimizerHistory: (offset = 0) => ipcRenderer.invoke("shell:optimizer-history", offset),
  optimizerExportReport: () => ipcRenderer.invoke("shell:optimizer-export"),
  optimizerOpenWindowsSettings: (section) =>
    ipcRenderer.invoke("shell:optimizer-windows-settings", section),
  onOptimizerProgress: (handler) => {
    const listener = (_event, progress) => handler(progress);
    ipcRenderer.on("shell:optimizer-progress", listener);
    return () => ipcRenderer.removeListener("shell:optimizer-progress", listener);
  },
  checkUpdates: () => ipcRenderer.invoke("shell:check-updates"),
  installUpdate: () => ipcRenderer.invoke("shell:install-update"),
  logoutCrm: () => ipcRenderer.invoke("shell:crm-logout"),
  setCrmPanelEnabled: (enabled) => ipcRenderer.invoke("shell:crm-panel", enabled),
  onShown: (handler) => {
    const listener = (_event, surface) => handler(surface);
    ipcRenderer.on("shell:shown", listener);
    return () => ipcRenderer.removeListener("shell:shown", listener);
  },
  onState: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on("shell:state", listener);
    return () => ipcRenderer.removeListener("shell:state", listener);
  },
  onLayout: (handler) => {
    const listener = (_event, layout) => handler(layout);
    ipcRenderer.on("shell:layout", listener);
    return () => ipcRenderer.removeListener("shell:layout", listener);
  },
  onPanel: (handler) => {
    const listener = (_event, panel) => handler(panel);
    ipcRenderer.on("shell:panel", listener);
    return () => ipcRenderer.removeListener("shell:panel", listener);
  },
  onPanelTab: (handler) => {
    const listener = (_event, tab) => handler(tab);
    ipcRenderer.on("shell:panel-tab", listener);
    return () => ipcRenderer.removeListener("shell:panel-tab", listener);
  },
  onNotifPanel: (handler) => {
    const listener = (_e, open) => handler(open);
    ipcRenderer.on("shell:notif-panel", listener);
    return () => ipcRenderer.removeListener("shell:notif-panel", listener);
  },
  onPalette: (handler) => {
    const listener = () => handler();
    ipcRenderer.on("shell:palette", listener);
    return () => ipcRenderer.removeListener("shell:palette", listener);
  },
  onToast: (handler) => {
    const listener = (_e, message) => handler(message);
    ipcRenderer.on("shell:toast", listener);
    return () => ipcRenderer.removeListener("shell:toast", listener);
  },
});
