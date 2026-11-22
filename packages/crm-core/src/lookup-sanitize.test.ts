import { describe, expect, it } from "vitest";
import { emptyLookupResult, sanitizeLookupResult } from "../src/lookup-sanitize.js";

describe("lookup sanitize", () => {
  it("keeps valid contacts and deals", () => {
    const result = sanitizeLookupResult({
      contacts: [
        {
          id: "c1",
          name: "Ada",
          phone: "5511",
          company: { id: "co1", name: "Acme", number: null },
        },
      ],
      deals: [{ id: "d1", title: "Deal", status: "open", stage: { name: "Negociação" } }],
      projects: [],
      warnings: [],
    });
    expect(result.contacts).toHaveLength(1);
    expect(result.deals[0]?.id).toBe("d1");
    expect(result.warnings).toEqual([]);
  });

  it("mantém contato só com telefone e o número do CRM", () => {
    const result = sanitizeLookupResult({
      contacts: [{ id: "c2", name: "", phone: "5511999", number: "42" }],
      deals: [],
      projects: [],
      warnings: [],
    });
    expect(result.contacts).toEqual([
      { id: "c2", name: "", number: "42", phone: "5511999", company: null },
    ]);
  });

  it("does not break the panel on unexpected payloads", () => {
    expect(sanitizeLookupResult(null)).toEqual(emptyLookupResult());
    expect(sanitizeLookupResult("boom")).toEqual(emptyLookupResult());
    const messy = sanitizeLookupResult({
      contacts: [{ id: 99 }, { id: "ok", name: "Ok" }, null, 3],
      deals: [{ title: "no-id" }, { id: "d2", valueCents: "x" }],
      projects: [{ id: "p1" }],
      warnings: [123, "aviso"],
    });
    expect(messy.contacts.map((c) => c.id)).toEqual(["ok"]);
    expect(messy.deals.map((d) => d.id)).toEqual(["d2"]);
    expect(messy.warnings.length).toBeGreaterThan(0);
    expect(messy.warnings).toContain("aviso");
  });
});
