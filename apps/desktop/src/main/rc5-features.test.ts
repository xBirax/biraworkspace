import { describe, expect, it } from "vitest";
import { stateDiff } from "./state-diff.js";
import { permissionGrantRows, revokeGrant } from "./profile-ipc.js";
import { dealFitsContact, dealMatchesFrom, meetingActivityPayload } from "./crm-meeting-log.js";
import { backupNoticeToShow, formatBytes } from "./profile-backup.js";
import { googleAccountEmails } from "./chrome-session.js";
import { calendarErrorMessage } from "./calendar-reminders.js";

describe("stateDiff (envio só do que mudou)", () => {
  it("primeira vez manda tudo; depois só as chaves que mudaram; nada = null", () => {
    const first = stateDiff({}, { a: 1, b: [1, 2], catalog: { x: 1 } });
    expect(first.changed).toEqual({ a: 1, b: [1, 2], catalog: { x: 1 } });
    const second = stateDiff(first.snapshot, { a: 2, b: [1, 2], catalog: { x: 1 } });
    expect(second.changed).toEqual({ a: 2 });
    expect(stateDiff(second.snapshot, { a: 2, b: [1, 2], catalog: { x: 1 } }).changed).toBeNull();
  });

  it("chave que sumiu vai como undefined, para a tela apagar o valor velho", () => {
    const before = stateDiff({}, { a: 1, extra: "x" }).snapshot;
    const after = stateDiff(before, { a: 1 });
    expect(after.changed).toEqual({ extra: undefined });
    expect("extra" in after.snapshot).toBe(false);
  });
});

describe("permissões lembradas", () => {
  const grants = {
    "https://web.whatsapp.com|media": true,
    "https://web.whatsapp.com|media:audio": true,
    "https://meet.google.com|notifications": true,
    "https://x.com|media:video": false,
  };

  it("lista só os 'Permitir', com nome legível, por site", () => {
    expect(permissionGrantRows(grants).map((row) => [row.origin, row.label])).toEqual([
      ["https://meet.google.com", "notificações"],
      ["https://web.whatsapp.com", "microfone"],
      ["https://web.whatsapp.com", "microfone/câmera"],
    ]);
  });

  it("revogar microfone leva junto o 'media' antigo; chave inexistente é recusada; '*' limpa", () => {
    expect(revokeGrant(grants, "https://web.whatsapp.com|media:audio")).toEqual({
      "https://meet.google.com|notifications": true,
      "https://x.com|media:video": false,
    });
    expect(revokeGrant(grants, "https://nao-existe|media")).toBeNull();
    expect(revokeGrant(grants, "constructor")).toBeNull();
    expect(revokeGrant(grants, "*")).toEqual({});
  });
});

describe("negócio e anotação no registro da reunião", () => {
  it("lê os negócios com número e etapa, abertos primeiro", () => {
    expect(
      dealMatchesFrom({
        items: [
          { id: "d1", number: 12, title: "Contrato antigo", status: "WON", companyId: "co1", stage: { name: "Ganho" } },
          { id: "d2", number: 40, title: "Renovação 2027", status: "OPEN", companyId: "co1", stage: { name: "Proposta" } },
          { title: "sem id" },
        ],
      }),
    ).toEqual([
      { id: "d2", title: "#40 Renovação 2027", stage: "Proposta", companyId: "co1" },
      { id: "d1", title: "#12 Contrato antigo", stage: "Ganho", companyId: "co1" },
    ]);
  });

  it("com negócio manda dealId e a empresa DELE (o CRM não a copia), e a anotação nas notas", () => {
    const payload = meetingActivityPayload({
      contact: { id: "c1", name: "Ana", companyId: "co9", companyName: "Outra", companyIds: ["co9", "co1"] },
      room: "abc-defg-hij",
      startedAt: 0,
      durationLabel: "30 min",
      deal: { id: "d2", title: "#40 Renovação", stage: null, companyId: "co1" },
      note: "Pediu proposta até sexta.",
    });
    expect(payload["dealId"]).toBe("d2");
    expect(payload["companyId"]).toBe("co1");
    expect(String(payload["notes"])).toContain("Pediu proposta até sexta.");
  });
});

describe("negócio compatível com o contato", () => {
  const contact = { id: "c1", name: "Ana", companyId: "co9", companyName: "A", companyIds: ["co9", "co2"] };
  const deal = (companyId: string | null) => ({ id: "d", title: "#1", stage: null, companyId });

  it("só oferece negócio da empresa principal, da segunda ou sem empresa (outro daria 400)", () => {
    expect(dealFitsContact(deal("co9"), contact)).toBe(true);
    expect(dealFitsContact(deal("co2"), contact)).toBe(true);
    expect(dealFitsContact(deal(null), contact)).toBe(true);
    expect(dealFitsContact(deal("co7"), contact)).toBe(false);
  });

  it("negócio sem empresa usa a empresa do contato", () => {
    const payload = meetingActivityPayload({
      contact,
      room: "abc-defg-hij",
      startedAt: 0,
      durationLabel: "5 min",
      deal: deal(null),
    });
    expect(payload).toMatchObject({ dealId: "d", companyId: "co9" });
  });
});

describe("aviso do último backup", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");

  it("mostra a cópia concluída com tamanho, uma vez e só nas últimas 24 h", () => {
    const done = { state: "done" as const, label: "manual", finishedAt: "2026-10-14T11:00:00Z", sizeBytes: 566_231_040 };
    expect(backupNoticeToShow(done, now)).toBe(
      "Backup do perfil concluído (540 MB). Ver em Configurações → Geral → Abrir pasta.",
    );
    expect(backupNoticeToShow({ ...done, acknowledged: true }, now)).toBeNull();
    expect(backupNoticeToShow({ ...done, finishedAt: "2026-10-12T11:00:00Z" }, now)).toBeNull();
    expect(backupNoticeToShow({ ...done, label: "auto-0.1.50" }, now)).toContain("antes da atualização");
  });

  it("falha tem prioridade e formatBytes passa a GB", () => {
    expect(
      backupNoticeToShow({ state: "failed", finishedAt: "2026-10-14T11:00:00Z", message: "robocopy 16" }, now),
    ).toBe("Backup do perfil: robocopy 16");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3,0 GB");
    expect(formatBytes(0)).toBe("0 MB");
    expect(formatBytes(1023.6 * 1024 ** 2)).toBe("1,0 GB");
    expect(formatBytes(1023.4 * 1024 ** 2)).toBe("1023 MB");
  });
});

describe("e-mails das contas Google da sessão", () => {
  it("lê a resposta do ListAccounts e ignora o resto", () => {
    const body = JSON.stringify([
      "gaia.l.a.r",
      [
        ["gaia.l.a", 1, "Fulano", "Fulano@ADR.com", "https://foto", 1, 1, 0],
        ["gaia.l.a", 1, "Pessoal", "eu@gmail.com", null, 1],
        ["gaia.l.a", 1, "Fulano de novo", "fulano@adr.com"],
      ],
    ]);
    expect(googleAccountEmails(body)).toEqual(["fulano@adr.com", "eu@gmail.com"]);
    expect(googleAccountEmails(`)]}'\n${body}`)).toHaveLength(2);
    expect(googleAccountEmails("<html>login</html>")).toEqual([]);
    expect(googleAccountEmails(JSON.stringify(["x", "nao-lista"]))).toEqual([]);
  });
});

describe("erros da agenda em português claro", () => {
  it("traduz endereço público (404), recusado (403) e falta de conexão", () => {
    expect(calendarErrorMessage(new Error("http:404"))).toContain("Endereço secreto");
    expect(calendarErrorMessage(new Error("http:403"))).toContain("Gere um novo endereço");
    expect(calendarErrorMessage(new Error("http:500"))).toContain("respondeu 500");
    expect(calendarErrorMessage(new Error("fetch failed"))).toContain("Sem conexão");
    expect(calendarErrorMessage(new Error("The operation was aborted due to timeout"))).toContain("demorou");
  });
});
