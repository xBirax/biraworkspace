import { describe, expect, it } from "vitest";
import { unreadFromGmailTitle } from "./gmail-badge.js";

describe("unreadFromGmailTitle", () => {
  it("lê o contador da caixa de entrada", () => {
    expect(unreadFromGmailTitle("Caixa de entrada (12) - fulano@adragencia.com.br - Gmail")).toBe(12);
    expect(unreadFromGmailTitle("Inbox (3) - fulano@gmail.com - Gmail")).toBe(3);
    expect(unreadFromGmailTitle("Caixa de entrada - fulano@gmail.com - Gmail")).toBe(0);
  });

  it("lê contador com separador de milhar", () => {
    expect(unreadFromGmailTitle("Inbox (1,234) - fulano@gmail.com - Gmail")).toBe(1234);
    expect(unreadFromGmailTitle("Caixa de entrada (1.234) - fulano@gmail.com - Gmail")).toBe(1234);
    expect(unreadFromGmailTitle("Posteingang (12 345) - fulano@gmail.com - Gmail")).toBe(12345);
    expect(unreadFromGmailTitle("Bandeja de entrada (1 234) - fulano@gmail.com - Gmail")).toBe(1234);
    expect(unreadFromGmailTitle("Inbox (1,234,567) - fulano@gmail.com - Gmail")).toBe(99999);
    // Separador fora do lugar não vira número: sem contador legível.
    expect(unreadFromGmailTitle("Inbox (1,2) - fulano@gmail.com - Gmail")).toBe(0);
  });

  it("fora da caixa de entrada não sabe o contador (não é zero)", () => {
    expect(unreadFromGmailTitle("Orçamento (2) - fulano@gmail.com - Gmail")).toBeNull();
    expect(unreadFromGmailTitle("Re: proposta (4) revisada - fulano@gmail.com - Gmail")).toBeNull();
    expect(unreadFromGmailTitle("Gmail")).toBeNull();
  });
});
