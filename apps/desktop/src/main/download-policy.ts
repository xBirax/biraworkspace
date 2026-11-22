import path from "node:path";

/**
 * Nomes que o Windows reserva em QUALQUER pasta, com ou sem extensão: gravar
 * `NUL.pdf` falha com erro obscuro, não com "nome inválido".
 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Extensões que o Windows executa ao abrir — abrir não pode ser o botão padrão. */
const EXECUTABLE_EXT = new Set([
  ".exe", ".msi", ".bat", ".cmd", ".com", ".scr", ".pif", ".ps1", ".psm1",
  ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".hta", ".cpl", ".msc",
  ".jar", ".reg", ".lnk", ".inf", ".appx", ".msix",
  // Também executam ou montam algo que executa: atalho de internet, imagem de
  // disco (abre com autorun/exe dentro), ajuda compilada, ClickOnce, patch do
  // Windows Installer, add-in do Excel, scriptlets e atalho de Configurações.
  ".url", ".iso", ".img", ".vhd", ".vhdx", ".chm", ".appref-ms", ".application",
  ".msp", ".xll", ".wsc", ".sct", ".settingcontent-ms", ".appxbundle", ".msixbundle",
  // Abrem conexão ou pasta remota sem perguntar (vazam o hash NTLM ou mapeiam
  // os discos locais para o servidor de quem mandou), solução de problemas,
  // OneNote/temas com conteúdo ativo, sandbox e instaladores de app.
  ".rdp", ".library-ms", ".search-ms", ".searchconnector-ms", ".diagcab", ".one",
  ".theme", ".themepack", ".scf", ".website", ".wsb", ".appinstaller",
  // Office com macro.
  ".xlsm", ".xlam", ".docm", ".dotm", ".pptm", ".ppam",
]);

export function isRiskyExecutable(filename: string): boolean {
  return EXECUTABLE_EXT.has(path.extname(String(filename || "")).toLowerCase());
}

/**
 * Tipos que podem ganhar "Abrir" como botão PADRÃO (Enter) no aviso de download
 * concluído. Qualquer outro não arriscado continua com "Abrir", mas o Enter vai
 * para "Mostrar na pasta": página pode disparar download sem clique, e a lista
 * acima nunca vai ser completa.
 */
// Sem .svg: abre no navegador como página e roda o script embutido.
const OPEN_BY_DEFAULT_EXT = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".txt", ".csv",
  ".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp", ".mp3", ".mp4", ".m4a", ".ogg",
  ".opus", ".wav", ".webm", ".mov", ".zip",
]);

export function opensByDefault(filename: string): boolean {
  return OPEN_BY_DEFAULT_EXT.has(path.extname(String(filename || "")).toLowerCase());
}

export function sanitizeDownloadFilename(filename: string): string {
  let safe = path
    .basename(String(filename || "download"))
    .replace(/[/\\?%*:|"<>]/g, "_")
    // Ponto e espaço no fim o Windows remove sozinho, e aí o nome que gravamos
    // deixa de bater com o que checamos em `exists`.
    .replace(/[. ]+$/, "");
  if (!safe) return "download";
  if (WINDOWS_RESERVED.test(safe)) safe = `_${safe}`;
  return safe;
}

/** Avoid overwriting: file.pdf → file (1).pdf → file (2).pdf */
export function reserveUniqueDownloadPath(
  directory: string,
  filename: string,
  exists: (fullPath: string) => boolean,
  reserved: Set<string>,
  platform: NodeJS.Platform = process.platform,
): string {
  const fullPath = uniqueDownloadPath(directory, filename, (candidate) =>
    exists(candidate) || reserved.has(downloadPathKey(candidate, platform)),
  );
  reserved.add(downloadPathKey(fullPath, platform));
  return fullPath;
}

export function releaseReservedDownloadPath(
  fullPath: string,
  reserved: Set<string>,
  platform: NodeJS.Platform = process.platform,
): void {
  reserved.delete(downloadPathKey(fullPath, platform));
}

function downloadPathKey(fullPath: string, platform: NodeJS.Platform): string {
  return platform === "win32"
    ? path.win32.resolve(fullPath).toLowerCase()
    : path.resolve(fullPath);
}

export function uniqueDownloadPath(
  directory: string,
  filename: string,
  exists: (fullPath: string) => boolean,
): string {
  const safe = sanitizeDownloadFilename(filename);
  const full = path.join(directory, safe);
  if (!exists(full)) return full;
  const ext = path.extname(safe);
  const stem = ext ? safe.slice(0, -ext.length) : safe;
  for (let i = 1; i < 10_000; i++) {
    const candidate = path.join(directory, `${stem} (${i})${ext}`);
    if (!exists(candidate)) return candidate;
  }
  return path.join(directory, `${stem}-${Date.now()}${ext}`);
}
