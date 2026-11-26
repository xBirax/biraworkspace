import { describe, expect, it, vi } from "vitest";
import { grantNames } from "./permission-policy.js";
import { isServiceOwnSite } from "./chrome-session.js";
import { messengerStaysAwake } from "./service-catalog.js";
import { MINI_WINDOW, miniWindowBounds, planReminders } from "./meet-calls.js";
import { backupScriptArgs, startBackupAndRestart } from "./profile-backup.js";
import { createOneShot } from "./one-shot-choice.js";
import { notificationPreview, notificationSilenced } from "./notifications.js";

describe("grantNames", () => {
  it("separa microfone e câmera e mantém as outras permissões", () => {
    expect(grantNames("media", ["audio", "video"])).toEqual(["media:audio", "media:video"]);
    expect(grantNames("media", ["audio"])).toEqual(["media:audio"]);
    // Pedido sem tipo (getDisplayMedia, check genérico) continua "media".
    expect(grantNames("media", [])).toEqual(["media"]);
    expect(grantNames("media", ["desconhecido"])).toEqual(["media"]);
    expect(grantNames("notifications", ["audio"])).toEqual(["notifications"]);
  });
});

describe("isServiceOwnSite", () => {
  it("aceita o site do serviço e os domínios dele", () => {
    expect(isServiceOwnSite("gmail", "https://mail.google.com/mail/u/0", "https://mail.google.com/")).toBe(true);
    expect(isServiceOwnSite("notion", "https://www.notion.com/x", "https://www.notion.so/")).toBe(true);
    expect(isServiceOwnSite("whatsapp", "https://web.whatsapp.com/", "https://web.whatsapp.com/")).toBe(true);
  });

  it("recusa outro site aberto dentro da aba, e CRM/shell/Bira Browser", () => {
    // No google.com cada app é um site: Calendar não é Gmail.
    expect(isServiceOwnSite("gmail", "https://calendar.google.com/", "https://mail.google.com/")).toBe(false);
    expect(isServiceOwnSite("chatgpt", "https://evil.example/", "https://chatgpt.com/")).toBe(false);
    for (const kind of ["crm", "shell", "panel", "browser"]) {
      expect(isServiceOwnSite(kind, "https://example.com/", "https://example.com/")).toBe(false);
    }
    expect(isServiceOwnSite("gmail", "não é url", "https://mail.google.com/")).toBe(false);
  });
});

describe("messengerStaysAwake", () => {
  it("segura WhatsApp e Gmail, menos em pressão crítica ou com a preferência desligada", () => {
    expect(messengerStaysAwake("whatsapp", true, "normal")).toBe(true);
    expect(messengerStaysAwake("gmail", true, "high")).toBe(true);
    expect(messengerStaysAwake("gmail", true, "critical")).toBe(false);
    expect(messengerStaysAwake("whatsapp", false, "normal")).toBe(false);
    expect(messengerStaysAwake("teams", true, "normal")).toBe(true);
    expect(messengerStaysAwake("outlook", true, "high")).toBe(true);
    expect(messengerStaysAwake("youtube", true, "normal")).toBe(false);
    expect(messengerStaysAwake(undefined, true, "normal")).toBe(false);
  });
});

describe("miniWindowBounds", () => {
  it("canto inferior esquerdo, acima do botão do Gmail, com largura limitada", () => {
    const main = { x: 100, y: 40, width: 1600, height: 900 };
    const bounds = miniWindowBounds(main)!;
    expect(bounds.width).toBe(MINI_WINDOW.maxWidth);
    expect(bounds.height).toBe(Math.round(MINI_WINDOW.maxWidth * MINI_WINDOW.aspect));
    expect(bounds.x).toBe(main.x + MINI_WINDOW.margin);
    expect(bounds.y + bounds.height).toBe(main.y + main.height - MINI_WINDOW.bottomGap);
    expect(miniWindowBounds({ x: 0, y: 0, width: 700, height: 500 })!.width).toBe(MINI_WINDOW.minWidth);
  });

  it("sem mini-janela numa área pequena demais", () => {
    expect(miniWindowBounds({ x: 0, y: 0, width: 600, height: 900 })).toBeNull();
    expect(miniWindowBounds({ x: 0, y: 0, width: 900, height: 400 })).toBeNull();
  });
});

describe("planReminders", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  const minute = 60_000;

  it("avisa já, agenda depois, ignora o que começou e o que já foi avisado", () => {
    const reminded = new Map<string, number>([["avisada", now + 30 * minute]]);
    const plan = planReminders(
      [
        { key: "agora", startsAt: now + 30_000 },
        { key: "depois", startsAt: now + 10 * minute },
        { key: "comecou", startsAt: now - minute },
        { key: "avisada", startsAt: now + 30 * minute },
      ],
      reminded,
      now,
      minute,
    );
    expect(plan.now).toEqual(["agora"]);
    expect(plan.later).toEqual([["depois", 9 * minute]]);
  });

  it("esquece avisadas de mais de 1 h e não planeja nada com lembrete desligado", () => {
    const reminded = new Map<string, number>([
      ["velha", now - 2 * 60 * minute],
      ["recente", now - 10 * minute],
    ]);
    expect(planReminders([{ key: "x", startsAt: now + 5 * minute }], reminded, now, 0)).toEqual({
      now: [],
      later: [],
    });
    expect([...reminded.keys()]).toEqual(["recente"]);
  });
});

describe("backup do perfil", () => {
  const request = {
    userData: "C:\\Users\\a\\AppData\\Roaming\\BiraWorkspace",
    scriptPath: "C:\\Programs\\adr\\resources\\backup-profile.ps1",
    relaunch: "",
    label: "manual" as const,
    backupsRoot: "C:\\Users\\a\\AppData\\Local\\BiraWorkspace Backups",
  };

  it("monta os argumentos sem -Relaunch quando não há o que reabrir", () => {
    const args = backupScriptArgs(request, 4242);
    expect(args).toContain("-File");
    expect(args[args.indexOf("-WaitPid") + 1]).toBe("4242");
    expect(args[args.indexOf("-BackupsRoot") + 1]).toBe(request.backupsRoot);
    expect(args).not.toContain("-Relaunch");
    expect(backupScriptArgs({ ...request, relaunch: "C:\\app.exe" }, 1).slice(-2)).toEqual([
      "-Relaunch",
      "C:\\app.exe",
    ]);
  });

  it("recusa fora do Windows e sem o script; agenda destacado no Windows", async () => {
    expect((await startBackupAndRestart(request, { platform: "linux" })).ok).toBe(false);
    expect((await startBackupAndRestart(request, { platform: "win32", exists: () => false })).ok).toBe(false);
    const child = { on: vi.fn(), unref: vi.fn() };
    const spawn = vi.fn(() => child);
    const result = await startBackupAndRestart(request, {
      platform: "win32",
      exists: () => true,
      spawn: spawn as never,
      pid: 7,
      ready: () => true,
    });
    expect(result.ok).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      "powershell.exe",
      expect.arrayContaining(backupScriptArgs(request, 7)),
      expect.objectContaining({ detached: true, shell: false }),
    );
    expect(child.unref).toHaveBeenCalled();
  });
});

describe("createOneShot", () => {
  it("clique depois do cancelamento por fechamento do menu é ignorado", () => {
    const picked = vi.fn();
    const cancelled = vi.fn();
    const choice = createOneShot<string>(picked, cancelled);
    choice.cancel();
    choice.pick("conta");
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(picked).not.toHaveBeenCalled();
    expect(choice.settled).toBe(true);
  });

  it("escolha antes do prazo vale e o cancelamento posterior não", () => {
    const picked = vi.fn();
    const cancelled = vi.fn();
    const choice = createOneShot<string>(picked, cancelled);
    choice.pick("conta");
    choice.cancel();
    expect(picked).toHaveBeenCalledWith("conta");
    expect(cancelled).not.toHaveBeenCalled();
  });
});

describe("regras do guard de notificações", () => {
  it("silencia por desligado, reunião ou horário, e volta quando a reunião acaba", () => {
    expect(notificationSilenced({ enabled: false }, 12)).toBe(true);
    expect(notificationSilenced({ meetingQuiet: true }, 12)).toBe(true);
    expect(notificationSilenced({ meetingQuiet: false }, 12)).toBe(false);
    expect(notificationSilenced({ quietHours: true, quietFromHour: 19, quietToHour: 8 }, 22)).toBe(true);
    expect(notificationSilenced({ quietHours: true, quietFromHour: 19, quietToHour: 8 }, 12)).toBe(false);
  });

  it("com PIN troca o texto e tira a imagem; sem PIN devolve as opções intactas", () => {
    const options = { body: "segredo", image: "foto.png", icon: "avatar.png" };
    expect(notificationPreview({ hidePreview: true }, options)).toEqual({
      body: "Nova mensagem",
      image: undefined,
      icon: "avatar.png",
    });
    expect(notificationPreview({}, options)).toBe(options);
  });
});
