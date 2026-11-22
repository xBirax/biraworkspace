// Resolve "system" contra o tema do SO e marcar no <html> — usado por todas as superfícies do shell.
function applyTheme(state) {
  const theme = (state && state.theme) || "system";
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : theme;
  document.documentElement.dataset.theme = resolved;
}
// O nativeTheme do main já segue o tema do app: aplicar já no carregamento evita
// a página nascer escura e piscar até o estado chegar.
applyTheme(window.__adrState || {});
window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
  applyTheme(window.__adrState || {});
});
