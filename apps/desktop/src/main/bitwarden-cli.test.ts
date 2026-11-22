import { describe, expect, it } from "vitest";
import {
  BitwardenError,
  parseBwStatus,
  pickBitwardenCli,
  pullBitwardenItems,
  type BwRunner,
} from "./bitwarden-cli.js";

/** CLI falsa: responde por comando e registra cada chamada. */
function fakeCli(responses: Record<string, { code?: number; stdout?: string }>) {
  const calls: Array<{ args: string[]; env: Record<string, string> }> = [];
  const run: BwRunner = async (args, env) => {
    calls.push({ args, env });
    const reply = responses[args[0]!] ?? {};
    return { code: reply.code ?? 0, stdout: reply.stdout ?? "", stderr: "" };
  };
  return { run, calls };
}

const unlocked = {
  status: { stdout: JSON.stringify({ status: "locked" }) },
  unlock: { stdout: "SESSAO123\n" },
  sync: {},
  list: { stdout: JSON.stringify([{ type: 1, login: { username: "a", password: "b" } }]) },
  lock: {},
};

describe("pickBitwardenCli", () => {
  it("prefere o .exe ao .cmd", () => {
    expect(pickBitwardenCli("C:\\npm\\bw.cmd\r\nC:\\WinGet\\Links\\bw.exe\r\n")).toBe(
      "C:\\WinGet\\Links\\bw.exe",
    );
    expect(pickBitwardenCli("C:\\npm\\bw.cmd\r\n")).toBe("C:\\npm\\bw.cmd");
    expect(pickBitwardenCli("")).toBeNull();
  });
});

describe("parseBwStatus", () => {
  it("lê o status e tolera lixo", () => {
    expect(parseBwStatus('{"status":"unlocked","userEmail":"x"}')).toBe("unlocked");
    expect(parseBwStatus("? Master password:")).toBeNull();
  });
});

describe("pullBitwardenItems", () => {
  it("desbloqueia pela variável de ambiente, lista e tranca", async () => {
    const { run, calls } = fakeCli(unlocked);
    const result = await pullBitwardenItems(run, "senha mestra");
    expect(result.synced).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(calls.map((c) => c.args[0])).toEqual(["status", "unlock", "sync", "list", "lock"]);
    const unlock = calls[1]!;
    // A senha nunca vai na linha de comando.
    expect(unlock.args.join(" ")).not.toContain("senha mestra");
    expect(Object.values(unlock.env)).toContain("senha mestra");
    expect(calls[3]!.env).toEqual({ BW_SESSION: "SESSAO123" });
  });

  it("sem conta conectada, pede o bw login e nem tenta desbloquear", async () => {
    const { run, calls } = fakeCli({ status: { stdout: '{"status":"unauthenticated"}' } });
    await expect(pullBitwardenItems(run, "x")).rejects.toMatchObject({ code: "logged-out" });
    expect(calls.map((c) => c.args[0])).toEqual(["status"]);
  });

  it("senha errada não lista nada", async () => {
    const { run, calls } = fakeCli({ ...unlocked, unlock: { code: 1, stdout: "" } });
    await expect(pullBitwardenItems(run, "errada")).rejects.toMatchObject({
      code: "wrong-password",
    });
    expect(calls.map((c) => c.args[0])).not.toContain("list");
  });

  it("tranca mesmo quando a listagem falha", async () => {
    const { run, calls } = fakeCli({ ...unlocked, list: { code: 1 } });
    await expect(pullBitwardenItems(run, "x")).rejects.toBeInstanceOf(BitwardenError);
    expect(calls.at(-1)!.args[0]).toBe("lock");
  });

  it("resposta que não é lista falha em vez de virar cofre vazio", async () => {
    const { run } = fakeCli({ ...unlocked, list: { stdout: JSON.stringify({ message: "erro" }) } });
    await expect(pullBitwardenItems(run, "x")).rejects.toBeInstanceOf(BitwardenError);
  });

  it("sem internet segue com o último sync da CLI", async () => {
    const { run } = fakeCli({ ...unlocked, sync: { code: 1 } });
    const result = await pullBitwardenItems(run, "x");
    expect(result.synced).toBe(false);
  });
});

describe("pullBitwardenItems com status já lido", () => {
  it("não chama o bw status de novo", async () => {
    const { run, calls } = fakeCli(unlocked);
    await pullBitwardenItems(run, "x", "locked");
    expect(calls.map((c) => c.args[0])).toEqual(["unlock", "sync", "list", "lock"]);
  });
});
