import { describe, expect, it } from "vitest";
import { shouldPersistSpotifyCookie } from "./spotify-cookie.js";

describe("shouldPersistSpotifyCookie", () => {
  it("regrava o cookie de login que veio sem validade", () => {
    expect(shouldPersistSpotifyCookie({ name: "sp_dc", session: true }, false)).toBe(true);
    expect(shouldPersistSpotifyCookie({ name: "sp_key", session: true }, false)).toBe(true);
  });

  it("não reentra no cookie que ela mesma acabou de gravar", () => {
    // Guarda de recursão: o regravado tem session=false. Sem isto, laço infinito.
    expect(shouldPersistSpotifyCookie({ name: "sp_dc", session: false }, false)).toBe(false);
  });

  it("não ressuscita cookie removido", () => {
    expect(shouldPersistSpotifyCookie({ name: "sp_dc", session: true }, true)).toBe(false);
  });

  it("não prolonga cookie de rastreio nem de terceiro", () => {
    expect(shouldPersistSpotifyCookie({ name: "sp_adid", session: true }, false)).toBe(false);
    expect(shouldPersistSpotifyCookie({ name: "sp_t", session: true }, false)).toBe(false);
  });
});
