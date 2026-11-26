import { describe, it, expect } from "vitest";
import { ADR_APP_URL, allowAdrBrowserRequest, isAdrEndpoint, privacyMode, protectedNotifications } from "./personal-policy.js";
describe("política pessoal", () => {
  it("abre o favorito de uma aba nova e mantém a regra de isolamento nos serviços", () => {
    const request = { url: ADR_APP_URL, resourceType: "mainFrame" as const, referrer: "", webContentsId: 1 };
    expect(allowAdrBrowserRequest(request, "")).toBe(true);
    expect(allowAdrBrowserRequest(request, undefined)).toBe(false);
    expect(allowAdrBrowserRequest({ ...request, url: "https://outro.adragencia.com.br/" }, "")).toBe(false);
  });
  it("carrega os recursos necessários ao ADR depois do redirecionamento de login", () => {
    const page = ADR_APP_URL + "login";
    const script = { url: ADR_APP_URL + "app.js", resourceType: "script" as const, referrer: page };
    expect(allowAdrBrowserRequest(script, undefined)).toBe(true); // service worker
    expect(allowAdrBrowserRequest({ ...script, referrer: "" }, page)).toBe(true);
    expect(allowAdrBrowserRequest({ ...script, referrer: "https://outro.example/" }, "")).toBe(false);
    expect(allowAdrBrowserRequest({ ...script, url: "wss://app.adragencia.com.br/live", resourceType: "webSocket" }, page)).toBe(true);
  });
  it("bloqueia domínio ADR e subdomínios, sem bloquear nomes apenas semelhantes", () => {
    for (const url of ["https://adragencia.com.br", "https://app.adragencia.com.br/api", "https://x.app.adragencia.com.br"]) expect(isAdrEndpoint(url)).toBe(true);
    for (const url of ["https://adragencia.com.br.example.org", "https://example.org/adragencia.com.br", "invalid"]) expect(isAdrEndpoint(url)).toBe(false);
  });
  it("preserva preferências e suprime todos os avisos de contas protegidas", () => {
    const original = {enabled:true,serviceEnabled:{a:true,b:false,c:true}};
    expect(protectedNotifications(original,{a:"discreet",c:"presentation"}).serviceEnabled).toEqual({a:false,b:false,c:false});
    expect(original.serviceEnabled).toEqual({a:true,b:false,c:true});
    expect(protectedNotifications(original,{a:"normal"})).toEqual(original);
  });
  it("reconhece somente modos conhecidos", () => {
    expect(privacyMode("presentation")).toBe("presentation");
    expect(privacyMode("discreet")).toBe("discreet");
    expect(privacyMode(undefined)).toBe("normal");
  });
});
