import { execFile } from "node:child_process";

/**
 * Sincronização Bitwarden → Cofre ADR pela CLI oficial (`bw`), que a pessoa
 * instala (o app não embute a CLI, que é GPL). Desbloqueia, puxa, lista os
 * itens e TRANCA de novo, sempre — inclusive quando algo falha no meio. Nada
 * de `bw serve`: ele deixa o cofre aberto em localhost para qualquer programa.
 *
 * A senha mestra vai por variável de ambiente (`--passwordenv`), nunca na
 * linha de comando (visível na lista de processos), e não fica guardada.
 * O login (com 2FA) é feito uma vez pela pessoa, no terminal: `bw login`.
 */

export type BwResult = { code: number | null; stdout: string; stderr: string };
export type BwRunner = (
  args: string[],
  env: Record<string, string>,
  timeoutMs: number,
) => Promise<BwResult>;

export type BitwardenErrorCode = "not-installed" | "logged-out" | "wrong-password" | "failed";

export class BitwardenError extends Error {
  constructor(
    readonly code: BitwardenErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const PASSWORD_ENV = "ADR_BW_MASTER_PASSWORD";

/** Caminho da CLI pelo PATH (`where bw`); prefere o .exe (winget) ao .cmd (npm). */
export function pickBitwardenCli(whereOutput: string): string | null {
  const paths = whereOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\.(exe|cmd)$/i.test(line));
  return paths.find((p) => /\.exe$/i.test(p)) ?? paths[0] ?? null;
}

export function findBitwardenCli(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("where.exe", ["bw"], { windowsHide: true, timeout: 10_000 }, (error, stdout) =>
      resolve(error ? null : pickBitwardenCli(String(stdout))),
    );
  });
}

/**
 * Executa a CLI sem shell. O .cmd (instalação por npm) só roda pelo cmd.exe;
 * os argumentos são sempre constantes deste arquivo, nunca texto de fora.
 */
export function createBwRunner(bwPath: string): BwRunner {
  const viaCmd = /\.cmd$/i.test(bwPath);
  return (args, env, timeoutMs) =>
    new Promise((resolve) => {
      execFile(
        viaCmd ? "cmd.exe" : bwPath,
        viaCmd ? ["/d", "/c", bwPath, ...args] : args,
        {
          env: { ...process.env, ...env },
          windowsHide: true,
          timeout: timeoutMs,
          maxBuffer: 256 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
          resolve({ code, stdout: String(stdout), stderr: String(stderr) });
        },
      );
    });
}

/** `bw status`: unauthenticated | locked | unlocked (ou null se ilegível). */
export function parseBwStatus(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout.trim()) as { status?: unknown };
    return typeof parsed.status === "string" ? parsed.status : null;
  } catch {
    return null;
  }
}

/** Situação da conta na CLI, antes de pedir a senha mestra. */
export async function bitwardenStatus(run: BwRunner): Promise<string | null> {
  const result = await run(["status", "--nointeraction"], {}, 30_000);
  return result.code === 0 ? parseBwStatus(result.stdout) : null;
}

/**
 * Desbloqueia, puxa do servidor, lista os itens e tranca. Devolve os itens
 * crus de `bw list items` (o mapeamento fica em bitwardenItemsToEntries).
 * `synced` falso = sem internet: os itens são os do último sync da CLI.
 */
export async function pullBitwardenItems(
  run: BwRunner,
  masterPassword: string,
  // Status já lido por quem chamou: poupa um `bw` (1–2 s cada).
  knownStatus?: string | null,
): Promise<{ items: unknown; synced: boolean }> {
  const status = knownStatus ?? (await bitwardenStatus(run));
  if (!status) throw new BitwardenError("failed", "A CLI do Bitwarden não respondeu.");
  if (status === "unauthenticated") {
    throw new BitwardenError("logged-out", "A CLI do Bitwarden não está conectada a uma conta.");
  }
  const unlock = await run(
    ["unlock", "--passwordenv", PASSWORD_ENV, "--raw", "--nointeraction"],
    { [PASSWORD_ENV]: masterPassword },
    120_000,
  );
  const session = unlock.stdout.trim();
  if (unlock.code !== 0 || !session) {
    throw new BitwardenError("wrong-password", "Senha mestra incorreta ou cofre indisponível.");
  }
  const env = { BW_SESSION: session };
  try {
    const sync = await run(["sync", "--nointeraction"], env, 120_000);
    const list = await run(["list", "items", "--nointeraction"], env, 120_000);
    if (list.code !== 0) {
      throw new BitwardenError("failed", "Não foi possível ler o cofre do Bitwarden.");
    }
    let items: unknown;
    try {
      items = JSON.parse(list.stdout);
    } catch {
      throw new BitwardenError("failed", "A CLI do Bitwarden devolveu uma resposta ilegível.");
    }
    // Objeto no lugar da lista (erro, outra versão da CLI) virava "cofre vazio"
    // e o espelhamento apagava todas as senhas vindas do Bitwarden.
    if (!Array.isArray(items)) {
      throw new BitwardenError("failed", "A CLI do Bitwarden devolveu uma resposta inesperada.");
    }
    return { items, synced: sync.code === 0 };
  } finally {
    // Tranca sempre: a sessão aberta valeria para qualquer `bw` desta conta.
    await run(["lock", "--nointeraction"], env, 30_000);
  }
}
