export type UpdateCheckResult = {
  ok: boolean;
  checkedAt: string;
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  downloadUrl?: string;
  releaseNotesUrl?: string;
  message?: string;
};

export type ReleaseAsset = { name: string; browser_download_url: string };
export type ReleasePayload = {
  tag_name?: string;
  html_url?: string;
  assets?: ReleaseAsset[];
};

function normalizeVersion(v: string): string {
  return v.replace(/^v/i, "").trim();
}

/** `1.2.3-spike.1` → { core: [1,2,3], pre: "spike.1" } */
function splitVersion(value: string): { core: number[]; pre: string } {
  const [main = "", ...rest] = normalizeVersion(value).split("-");
  return {
    core: main.split(".").map((x) => Number.parseInt(x, 10) || 0),
    pre: rest.join("-"),
  };
}

/**
 * Semver-ish compare: 1 if a>b, -1 if a<b, 0 if equal/unknown.
 *
 * O pré-release entra na conta: antes `parseInt("0-spike")` dava 0, então
 * `0.1.0-spike` empatava com `0.1.0` e o release final nunca era oferecido a
 * quem estava na prerelease. Por semver, ter pré-release é MENOR que não ter.
 */
export function compareVersions(a: string, b: string): number {
  const va = splitVersion(a);
  const vb = splitVersion(b);
  const n = Math.max(va.core.length, vb.core.length);
  for (let i = 0; i < n; i++) {
    const da = va.core[i] || 0;
    const db = vb.core[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  if (va.pre === vb.pre) return 0;
  if (!va.pre) return 1;
  if (!vb.pre) return -1;
  const aParts = va.pre.split(".");
  const bParts = vb.pre.split(".");
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i];
    const bPart = bParts[i];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    const aNumeric = /^\d+$/.test(aPart);
    const bNumeric = /^\d+$/.test(bPart);
    if (aNumeric && bNumeric) {
      const aNumber = BigInt(aPart);
      const bNumber = BigInt(bPart);
      if (aNumber !== bNumber) return aNumber > bNumber ? 1 : -1;
    } else if (aNumeric !== bNumeric) {
      return aNumeric ? -1 : 1;
    } else if (aPart !== bPart) {
      return aPart > bPart ? 1 : -1;
    }
  }
  return 0;
}

export function pickLinuxAsset(
  assets: ReleaseAsset[],
  prefer: "deb" | "AppImage" = "deb",
): string | undefined {
  const match = assets.find((a) => a.name.endsWith(prefer === "deb" ? ".deb" : ".AppImage"));
  return match?.browser_download_url;
}

export function shouldCheckForUpdatesAt(
  lastCheckAt: number | undefined,
  now = Date.now(),
  minIntervalMs = 24 * 60 * 60 * 1000,
): boolean {
  if (!lastCheckAt) return true;
  return now - lastCheckAt >= minIntervalMs;
}

export async function checkGithubUpdatesPure(opts: {
  repo: string;
  currentVersion: string;
  fetchImpl?: typeof fetch;
  nowIso?: string;
}): Promise<UpdateCheckResult> {
  const checkedAt = opts.nowIso || new Date().toISOString();
  const currentVersion = opts.currentVersion;
  const repo = opts.repo;
  if (!repo || !repo.includes("/")) {
    return {
      ok: true,
      checkedAt,
      currentVersion,
      updateAvailable: false,
      message: "Repositório de updates não configurado (ADR_UPDATE_REPO).",
    };
  }
  const fetchImpl = opts.fetchImpl || fetch;
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "ADR-Workspace" },
    });
    if (!res.ok) {
      // GitHub may return a large error body. Leaving it unread can surface an
      // Undici parser assertion later, outside this try/catch, when the socket ends.
      await res.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        checkedAt,
        currentVersion,
        updateAvailable: false,
        message: `GitHub releases HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as ReleasePayload;
    const latestVersion = normalizeVersion(data.tag_name || "");
    const updateAvailable =
      Boolean(latestVersion) && compareVersions(latestVersion, currentVersion) > 0;
    const downloadUrl = pickLinuxAsset(data.assets || [], "deb");
    const result: UpdateCheckResult = {
      ok: true,
      checkedAt,
      currentVersion,
      updateAvailable,
      message: updateAvailable ? `Nova versão ${latestVersion}` : "Você está em dia",
    };
    if (latestVersion) result.latestVersion = latestVersion;
    if (downloadUrl) result.downloadUrl = downloadUrl;
    if (data.html_url) result.releaseNotesUrl = data.html_url;
    return result;
  } catch (error) {
    return {
      ok: false,
      checkedAt,
      currentVersion,
      updateAvailable: false,
      message: String((error as Error).message || error),
    };
  }
}

/** Silêncio exigido depois do último som antes de instalar sozinho. */
export const UPDATE_QUIET_MS = 5 * 60_000;

/**
 * Pode instalar a atualização baixada agora, sem ninguém pedir? Só com o
 * computador parado há 5 min e nada em andamento. "Nada tocando" é 5 min sem
 * som, não o instante do tick: numa reunião do Teams ou chamada do WhatsApp
 * ouvindo, o tick caía numa pausa da fala e o app fechava no meio da chamada.
 */
export function canInstallUpdateNow(opts: {
  systemIdleSeconds: number;
  now: number;
  lastAudibleAt: number;
  audibleNow: boolean;
  inMeetCall: boolean;
  downloading: boolean;
}): boolean {
  if (opts.systemIdleSeconds < 300) return false;
  if (opts.audibleNow || opts.inMeetCall || opts.downloading) return false;
  return opts.now - opts.lastAudibleAt >= UPDATE_QUIET_MS;
}
