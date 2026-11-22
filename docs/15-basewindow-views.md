# Refinamento 15 — BaseWindow e WebContentsView

O ciclo real vive em `workspace-window.ts`: `ensureServiceView` / `hibernateServiceView`
e `ensureCrmView` / `closeInactiveCrmViews`. Views nascem no clique e morrem no
hibernate (`removeChildView` + `webContents.close()`).

O shell Electron usa `BaseWindow` + `WebContentsView`.
