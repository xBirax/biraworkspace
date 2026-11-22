import { describe, expect, it } from "vitest";
import {
  bitwardenItemsToEntries,
  mergeVaultEntries,
  mirrorBitwardenEntries,
  vaultOriginMatch,
  normalizeVaultOrigin,
  parseCsvRows,
  parsePasswordCsv,
} from "./password-vault-format.js";

describe("password vault CSV", () => {
  it("parses quoted fields and normalizes login URLs to exact origins", () => {
    const parsed = parsePasswordCsv(
      '\uFEFFname,url,username,password,note\r\n"Loja, ADR",https://example.com/login,user@example.com,"a,b""c",x\r\n',
    );
    expect(parsed).toEqual({
      entries: [
        {
          name: "Loja, ADR",
          origin: "https://example.com",
          username: "user@example.com",
          password: 'a,b"c',
        },
      ],
      skipped: 0,
    });
  });

  it("does not accept non-web schemes or incomplete credentials", () => {
    const parsed = parsePasswordCsv(
      "url,username,password\njavascript:alert(1),a,b\nhttps://ok.example,,b\nhttps://ok.example,a,\n",
    );
    expect(parsed.entries).toHaveLength(0);
    expect(parsed.skipped).toBe(3);
    expect(normalizeVaultOrigin("ftp://example.com")).toBeNull();
  });

  it("updates duplicates without changing their stable id", () => {
    const current = [
      {
        id: "stable",
        origin: "https://example.com",
        username: "user",
        password: "old",
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const result = mergeVaultEntries(
      current,
      {
        entries: [
          {
            origin: "https://example.com",
            username: "user",
            password: "new",
          },
        ],
        skipped: 0,
      },
      2,
    );
    expect(result.imported).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.entries[0]).toMatchObject({
      id: "stable",
      password: "new",
      createdAt: 1,
      updatedAt: 2,
    });
  });

  it("imports the Bitwarden CSV export", () => {
    // Cabeçalho e tipos de linha como o Bitwarden exporta: login, nota segura
    // (sem login) e cartão — só o login entra no cofre.
    const csv = [
      "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp",
      'Trabalho,1,login,CRM ADR,,,0,https://app.adragencia.com.br/login,bira@adr.com.br,"s3nh@,forte",',
      ",,note,Anotação,texto qualquer,,0,,,,",
      ",,card,Cartão,,,0,,,,",
    ].join("\n");
    expect(parsePasswordCsv(csv)).toEqual({
      entries: [
        {
          name: "CRM ADR",
          origin: "https://app.adragencia.com.br",
          username: "bira@adr.com.br",
          password: "s3nh@,forte",
        },
      ],
      skipped: 2,
    });
  });

  it("uses the first web address of a Bitwarden login with several URIs", () => {
    const csv =
      "type,name,login_uri,login_username,login_password\n" +
      'login,Loja,"androidapp://com.loja,https://loja.example/entrar,https://outra.example",ana,pw\n';
    expect(parsePasswordCsv(csv).entries).toEqual([
      { name: "Loja", origin: "https://loja.example", username: "ana", password: "pw" },
    ]);
  });

  it("treats an address saved without scheme as https", () => {
    const csv = "login_uri,login_username,login_password\nexemplo.com.br/login,ana,pw\n";
    expect(parsePasswordCsv(csv).entries[0]?.origin).toBe("https://exemplo.com.br");
  });

  it("still refuses non-web schemes among Bitwarden URIs", () => {
    const csv =
      'login_uri,login_username,login_password\n"javascript:alert(1),file:///c:/x",ana,pw\n';
    const parsed = parsePasswordCsv(csv);
    expect(parsed.entries).toHaveLength(0);
    expect(parsed.skipped).toBe(1);
  });

  it("rejects malformed quoted CSV", () => {
    expect(() => parseCsvRows('url,username,password\n"https://example.com,a,b')).toThrow(
      /aspas/,
    );
  });
});

describe("vaultOriginMatch (preenchimento por domínio)", () => {
  it("sufixo público ou rótulo único não vale para os sites abaixo dele", () => {
    expect(vaultOriginMatch("https://com.br", "https://banco.com.br/login")).toBe(0);
    expect(vaultOriginMatch("https://intranet", "https://app.intranet/")).toBe(0);
    expect(vaultOriginMatch("https://loja.com.br", "https://app.loja.com.br/")).toBe(1);
  });

  it("mesma origem e subdomínios do site salvo", () => {
    expect(vaultOriginMatch("https://example.com", "https://example.com/login")).toBe(2);
    expect(vaultOriginMatch("https://example.com", "https://app.example.com/")).toBe(1);
    expect(vaultOriginMatch("https://www.example.com", "https://login.example.com/")).toBe(1);
    expect(vaultOriginMatch("https://www.example.com", "https://example.com/")).toBe(1);
  });

  it("nunca entre sites irmãos nem para o domínio de cima", () => {
    expect(vaultOriginMatch("https://fulano.github.io", "https://ciclano.github.io/")).toBe(0);
    expect(vaultOriginMatch("https://app.example.com", "https://example.com/")).toBe(0);
    expect(vaultOriginMatch("https://example.com", "https://notexample.com/")).toBe(0);
    expect(vaultOriginMatch("https://example.com", "https://example.com.evil.net/")).toBe(0);
  });

  it("login http vale no https do mesmo site; o contrário nunca", () => {
    expect(vaultOriginMatch("http://intranet.example", "https://intranet.example/")).toBe(1);
    expect(vaultOriginMatch("http://example.com", "https://app.example.com/")).toBe(1);
  });

  it("exato (host do Bitwarden) não vale para subdomínios", () => {
    expect(vaultOriginMatch("https://admin.example.com", "https://admin.example.com/", true)).toBe(
      2,
    );
    expect(vaultOriginMatch("https://example.com", "https://app.example.com/", true)).toBe(0);
  });

  it("esquema e porta precisam bater", () => {
    expect(vaultOriginMatch("https://example.com", "http://example.com/")).toBe(0);
    expect(vaultOriginMatch("https://example.com:8443", "https://example.com/")).toBe(0);
    expect(vaultOriginMatch("https://example.com", "file:///c:/x")).toBe(0);
  });
});

describe("bitwardenItemsToEntries", () => {
  it("um login com vários endereços vira uma entrada por site", () => {
    const parsed = bitwardenItemsToEntries([
      {
        type: 1,
        name: "Loja",
        login: {
          username: "ana",
          password: "pw",
          uris: [
            { uri: "https://loja.example/entrar", match: null },
            { uri: "androidapp://com.loja", match: null },
            { uri: "outra.example", match: 0 },
            { uri: "^https://.*", match: 4 },
            { uri: "https://nunca.example", match: 5 },
          ],
        },
      },
      { type: 2, name: "Nota", secureNote: {} },
      {
        type: 1,
        name: "Sem usuário",
        login: { password: "x", uris: [{ uri: "https://a.example" }] },
      },
    ]);
    expect(parsed.entries).toEqual([
      {
        origin: "https://loja.example",
        username: "ana",
        password: "pw",
        name: "Loja",
        exactOrigin: false,
      },
      {
        origin: "https://outra.example",
        username: "ana",
        password: "pw",
        name: "Loja",
        exactOrigin: false,
      },
    ]);
    expect(parsed.skipped).toBe(2);
  });

  it("resposta que não é lista não quebra", () => {
    expect(bitwardenItemsToEntries({ erro: 1 })).toEqual({ entries: [], skipped: 0 });
  });
});

describe("mirrorBitwardenEntries", () => {
  const entry = (origin: string, username: string, source?: "bitwarden") => ({
    id: `${origin}-${username}`,
    origin,
    username,
    password: "old",
    createdAt: 1,
    updatedAt: 1,
    ...(source ? { source } : {}),
  });

  it("cria, atualiza e apaga o que saiu do Bitwarden; o resto fica", () => {
    const current = [
      entry("https://a.example", "ana", "bitwarden"),
      entry("https://gone.example", "ana", "bitwarden"),
      entry("https://manual.example", "bia"),
    ];
    const result = mirrorBitwardenEntries(
      current,
      {
        entries: [
          { origin: "https://a.example", username: "ana", password: "new" },
          { origin: "https://b.example", username: "ana", password: "pw" },
        ],
        skipped: 0,
      },
      2,
    );
    expect(result).toMatchObject({ imported: 1, updated: 1, removed: 1 });
    const byOrigin = Object.fromEntries(result.entries.map((e) => [e.origin, e]));
    expect(byOrigin["https://a.example"]).toMatchObject({ password: "new", source: "bitwarden" });
    expect(byOrigin["https://b.example"]).toMatchObject({ source: "bitwarden" });
    expect(byOrigin["https://gone.example"]).toBeUndefined();
    expect(byOrigin["https://manual.example"]).toBeDefined();
  });

  it("credencial manual com o mesmo login recebe a senha mas nunca é apagada", () => {
    const current = [entry("https://manual.example", "bia")];
    const first = mirrorBitwardenEntries(current, {
      entries: [{ origin: "https://manual.example", username: "bia", password: "new" }],
      skipped: 0,
    });
    expect(first.entries[0]).toMatchObject({ password: "new" });
    expect(first.entries[0]!.source).toBeUndefined();
    const second = mirrorBitwardenEntries(first.entries, { entries: [], skipped: 0 });
    expect(second.entries).toHaveLength(1);
    expect(second.removed).toBe(0);
  });
});
