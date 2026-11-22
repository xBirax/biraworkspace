import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import {
  MEET_IN_CALL_PROBE,
  isMeetCallUrl,
  isMeetUrl,
  meetRoom,
  screenShareChoices,
  teamsInCall,
} from "./meet.js";

describe("isMeetUrl / isMeetCallUrl", () => {
  it.each([
    "https://meet.google.com/abc-defg-hij",
    "https://meet.google.com/abc-defg-hij?authuser=1",
    "https://meet.google.com/ABC-DEFG-HIJ/",
  ])("reconhece uma sala: %s", (url) => {
    expect(isMeetUrl(url)).toBe(true);
    expect(isMeetCallUrl(url)).toBe(true);
  });

  it.each(["https://meet.google.com/", "https://meet.google.com/landing", "https://meet.google.com/new"])(
    "página do Meet que não é sala: %s",
    (url) => {
      expect(isMeetUrl(url)).toBe(true);
      expect(isMeetCallUrl(url)).toBe(false);
    },
  );

  it.each([
    "http://meet.google.com/abc-defg-hij",
    "https://meet.google.com.evil.example/abc-defg-hij",
    "https://u:p@meet.google.com/abc-defg-hij",
    "https://calendar.google.com/abc-defg-hij",
    "not a url",
  ])("não confunde com outra origem: %s", (url) => {
    expect(isMeetUrl(url)).toBe(false);
    expect(isMeetCallUrl(url)).toBe(false);
  });
});

describe("meetRoom", () => {
  it("normaliza o código da sala e ignora o que não é sala", () => {
    expect(meetRoom("https://meet.google.com/ABC-defg-hij?authuser=1")).toBe("abc-defg-hij");
    expect(meetRoom("https://meet.google.com/")).toBe("");
    expect(meetRoom("not a url")).toBe("");
  });
});

describe("MEET_IN_CALL_PROBE", () => {
  const run = (labels: string[]): boolean => {
    const nodes = labels.map((label) => ({ getAttribute: () => label }));
    const fakeDocument = { querySelectorAll: () => nodes };
    return new Function("document", `return ${MEET_IN_CALL_PROBE}`)(fakeDocument) as boolean;
  };

  it("só diz que está na chamada com o botão de sair da chamada", () => {
    expect(run(["Ativar microfone", "Sair da chamada"])).toBe(true);
    expect(run(["Leave call"])).toBe(true);
    // Tela "Pronto para participar?": tem câmera e microfone, mas não "sair".
    expect(run(["Desativar câmera", "Participar agora"])).toBe(false);
    expect(run([])).toBe(false);
  });
});

describe("screenShareChoices", () => {
  const sources = [
    { id: "window:1:0", name: "Planilha de vendas.xlsx - Excel" },
    { id: "screen:0:0", name: "Entire screen" },
    { id: "window:2:0", name: "   " },
  ];

  it("põe a tela antes das janelas e ignora janela sem nome", () => {
    expect(screenShareChoices(sources)).toEqual([
      { label: "Tela inteira", sourceId: "screen:0:0" },
      { label: "Janela: Planilha de vendas.xlsx - Excel", sourceId: "window:1:0" },
    ]);
  });

  it("numera várias telas e encurta nome de janela longo", () => {
    const many = screenShareChoices([
      { id: "screen:0:0", name: "Tela 1" },
      { id: "screen:1:0", name: "Tela 2" },
      { id: "window:9:0", name: "x".repeat(80) },
    ]);
    expect(many.map((choice) => choice.label.slice(0, 7))).toEqual(["Tela 1 ", "Tela 2 ", "Janela:"]);
    // 57 caracteres do nome + reticências: "Janela: " + 58 = 66.
    expect(many[2]!.label).toBe(`Janela: ${"x".repeat(57)}…`);
  });
});

describe("teamsInCall", () => {
  const page = (hangup: boolean) => ({
    executeJavaScript: async (code: string) =>
      runInNewContext(code, { document: { getElementById: (id: string) => (hangup && id === "hangup-button" ? {} : null) } }),
  });

  it("só o botão Sair da sala marca a chamada", async () => {
    expect(await teamsInCall(page(true))).toBe(true);
    expect(await teamsInCall(page(false))).toBe(false);
  });

  it("sonda que falha ou não responde mantém a aba", async () => {
    expect(await teamsInCall({ executeJavaScript: () => Promise.reject(new Error("aba morta")) })).toBe(true);
    expect(await teamsInCall({ executeJavaScript: () => new Promise(() => {}) }, 10)).toBe(true);
  });
});
