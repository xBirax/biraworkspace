import { describe, expect, it } from "vitest";
import {
  isChromeWebStoreUrl,
  isSameOriginAs,
  isTeamsMeetingUrl,
  isWhatsAppAppUrl,
  outlookHomeFor,
  teamsMeetingTarget,
  serviceDriftedOffSite,
  shouldOpenServiceUrlExternally,
  servicePopupDisposition,
  siteOf,
  unwrapRedirectUrl,
  browserRestoreUrl,
  browserHistorySnapshot,
  resolveNavInput,
} from "./service-navigation.js";

describe("resolveNavInput", () => {
  it("abre endereços locais em http em vez de buscar no Google", () => {
    expect(resolveNavInput("192.168.0.1")).toBe("http://192.168.0.1");
    expect(resolveNavInput("localhost:5173/app")).toBe("http://localhost:5173/app");
    expect(resolveNavInput("[::1]:8080")).toBe("http://[::1]:8080");
  });

  it("mantém domínios, URLs explícitas e busca", () => {
    expect(resolveNavInput("example.com/x")).toBe("https://example.com/x");
    expect(resolveNavInput("http://intranet/x")).toBe("http://intranet/x");
    expect(resolveNavInput("")).toBe("https://www.google.com/");
    expect(resolveNavInput("preço dólar")).toBe(
      "https://www.google.com/search?q=pre%C3%A7o%20d%C3%B3lar",
    );
  });
});

const CRM_URL = "https://app.adragencia.com.br/";

describe("browser restoration", () => {
  it("keeps back/forward entries and index without replaying error cards or form state", () => {
    const entries = [
      { url: "https://example.org/", title: "Home", pageState: "sensitive" },
      { url: "data:text/html,error", title: "Error" },
      { url: "https://example.org/current", title: "Current" },
      { url: "https://example.org/next", title: "Next" },
    ];
    expect(browserHistorySnapshot(entries, 2)).toEqual({
      entries: [entries[0], entries[2], entries[3]].map((e) => ({ url: e!.url, title: e!.title })),
      index: 1,
    });
    expect(browserHistorySnapshot(entries, 1)).toBeUndefined();
  });
  it("prefers the suspended page and otherwise honors startUrl", () => {
    expect(
      browserRestoreUrl("https://example.org/work", "https://example.org/work/42?q=test#notes"),
    ).toBe("https://example.org/work/42?q=test#notes");
    expect(browserRestoreUrl("https://example.org/work")).toBe("https://example.org/work");
  });
  it.each([
    "javascript:alert(1)",
    "file:///secret",
    "data:text/html,error",
    "mailto:user@example.org",
    "https://user:password@example.org/",
  ])("does not replay unsafe URL %s", (url) => {
    expect(browserRestoreUrl("https://example.org/", url)).toBe("https://example.org/");
    expect(browserRestoreUrl(url)).toBe("https://www.google.com/");
  });
});

// A aba do CRM parada no cartão de erro (um data:) ou em outro site precisa ser
// reconhecida como "fora de casa" — é o que faz recarregar voltar para o CRM.
describe("origem da view", () => {
  it("reconhece quando a view saiu do site dela", () => {
    expect(isSameOriginAs("https://app.adragencia.com.br/deals/42", CRM_URL)).toBe(true);
    expect(isSameOriginAs("https://accounts.google.com/signin", CRM_URL)).toBe(false);
    expect(isSameOriginAs("data:text/html;charset=utf-8,%3Ch3%3Eerro", CRM_URL)).toBe(false);
    expect(isSameOriginAs("about:blank", CRM_URL)).toBe(false);
    expect(isSameOriginAs("", CRM_URL)).toBe(false);
  });
});

describe("WhatsApp service navigation", () => {
  it("keeps WhatsApp routes inside the service view", () => {
    expect(isWhatsAppAppUrl("https://web.whatsapp.com/")).toBe(true);
    expect(isWhatsAppAppUrl("https://web.whatsapp.com/send?phone=5511999999999")).toBe(true);
    expect(shouldOpenServiceUrlExternally("whatsapp", "https://web.whatsapp.com/")).toBe(false);
  });

  it("opens conversation links outside without replacing WhatsApp", () => {
    expect(shouldOpenServiceUrlExternally("whatsapp", "https://example.com/article")).toBe(true);
    expect(shouldOpenServiceUrlExternally("whatsapp", "mailto:contato@example.com")).toBe(true);
  });

  it("does not change navigation policy for the embedded browser", () => {
    expect(shouldOpenServiceUrlExternally("browser", "https://example.com/article")).toBe(false);
  });
});

describe("service popups", () => {
  it("opens web links in the current non-WhatsApp service, including Google sign-in", () => {
    expect(servicePopupDisposition("gmail", "https://accounts.google.com/signin")).toBe("in-app");
    expect(servicePopupDisposition("browser", "https://example.com/article")).toBe("in-app");
  });

  it("abre o login social dos serviços com conta própria em janela com opener", () => {
    expect(servicePopupDisposition("claude", "https://accounts.google.com/o/oauth2/v2/auth?x=1")).toBe("popup");
    expect(servicePopupDisposition("chatgpt", "https://login.microsoftonline.com/common")).toBe("popup");
    expect(servicePopupDisposition("notion", "https://login.microsoft.com/consumers")).toBe("popup");
    expect(servicePopupDisposition("gmail", "https://accounts.google.com/signin")).toBe("in-app");
    expect(servicePopupDisposition("claude", "http://accounts.google.com/")).toBe("in-app");
    expect(servicePopupDisposition("claude", "https://evil.example/accounts.google.com")).toBe("in-app");
  });

  it("todo pedido de janela vira popup com opener, em qualquer serviço e site", () => {
    const gsi = "https://accounts.google.com/gsi/select?client_id=x";
    expect(servicePopupDisposition("browser", gsi, "new-window")).toBe("popup");
    expect(servicePopupDisposition("browser", "https://www.linkedin.com/oauth/v2/x", "new-window")).toBe("popup");
    expect(servicePopupDisposition("gmail", "https://pay.example.com/checkout", "new-window")).toBe("popup");
    // link com target=_blank continua na aba; WhatsApp continua no externo
    expect(servicePopupDisposition("browser", "https://example.com/article", "foreground-tab")).toBe("in-app");
    expect(servicePopupDisposition("whatsapp", "https://example.com/", "new-window")).toBe("external");
    expect(servicePopupDisposition("browser", "file:///C:/x", "new-window")).toBe("ignore");
  });

  it("link para outro site abre no navegador padrão; do próprio site, na aba", () => {
    const chat = "https://chatgpt.com/c/abc";
    expect(servicePopupDisposition("chatgpt", "https://bestory.com.br/", "foreground-tab", chat)).toBe("external");
    expect(servicePopupDisposition("chatgpt", "https://chatgpt.com/c/outra", "foreground-tab", chat)).toBe("in-app");
    // login segue na aba/janela; ADR Browser é o navegador do app
    expect(servicePopupDisposition("chatgpt", "https://accounts.google.com/o/oauth2", "foreground-tab", chat)).toBe("popup");
    expect(servicePopupDisposition("browser", "https://bestory.com.br/", "foreground-tab", "https://www.google.com/")).toBe("in-app");
    // redirecionador do Gmail: decide pelo destino real
    const gmail = "https://mail.google.com/mail/u/0/#inbox";
    expect(servicePopupDisposition("gmail", "https://www.google.com/url?q=https://example.com/x", "foreground-tab", gmail)).toBe("external");
    expect(servicePopupDisposition("gmail", "https://mail.google.com/mail/u/0/#inbox/123", "foreground-tab", gmail)).toBe("in-app");
    expect(servicePopupDisposition("calendar", "https://meet.google.com/abc", "foreground-tab", "https://calendar.google.com/")).toBe("external");
    expect(servicePopupDisposition("instagram", "https://l.instagram.com/?u=https%3A%2F%2Fexample.com%2F", "foreground-tab", "https://www.instagram.com/")).toBe("external");
  });

  it("desembrulha redirecionadores e reconhece o site", () => {
    expect(unwrapRedirectUrl("https://www.google.com/url?q=https://example.com/a&sa=D")).toBe("https://example.com/a");
    expect(unwrapRedirectUrl("https://l.instagram.com/?u=https%3A%2F%2Fexample.com%2F")).toBe("https://example.com/");
    expect(unwrapRedirectUrl("https://www.google.com/url?q=javascript:alert(1)")).toBe("https://www.google.com/url?q=javascript:alert(1)");
    expect(siteOf("www.adragencia.com.br")).toBe("adragencia.com.br");
    expect(siteOf("cdn.platform.openai.com")).toBe("openai.com");
    expect(siteOf("docs.google.com")).toBe("docs.google.com");
  });

  it("routes WhatsApp links and mailto to the external browser", () => {
    expect(servicePopupDisposition("whatsapp", "https://example.com/article")).toBe("external");
    expect(servicePopupDisposition("whatsapp", "https://web.whatsapp.com/send?phone=123")).toBe("in-app");
    expect(servicePopupDisposition("gmail", "mailto:user@example.com")).toBe("external");
  });

  it.each(["about:blank", "file:///C:/secret", "javascript:alert(1)", "data:text/html,hi", "https://user:password@example.com/"])(
    "ignores unsupported popup URL %s",
    (url) => expect(servicePopupDisposition("browser", url)).toBe("ignore"),
  );
});

describe("saiu do site do serviço", () => {
  const GMAIL = "https://mail.google.com/mail/u/0/";

  it("um link do Gmail que abre o Docs conta como fora do site", () => {
    expect(serviceDriftedOffSite("gmail", "https://docs.google.com/document/d/abc", GMAIL)).toBe(
      true,
    );
  });

  it("navegar dentro do próprio Gmail não conta", () => {
    expect(serviceDriftedOffSite("gmail", "https://mail.google.com/mail/u/0/#inbox", GMAIL)).toBe(
      false,
    );
  });

  it("cartão de erro (data:) conta como fora — é de onde o usuário precisa sair", () => {
    expect(serviceDriftedOffSite("gmail", "data:text/html,<h1>erro", GMAIL)).toBe(true);
  });

  it("view que ainda não navegou não conta", () => {
    expect(serviceDriftedOffSite("gmail", "", GMAIL)).toBe(false);
  });

  it("o ADR Browser nunca conta: a barra dele é fixa e recarregar não pode ir para casa", () => {
    expect(
      serviceDriftedOffSite("browser", "https://example.com/", "https://www.google.com/"),
    ).toBe(false);
  });
});

describe("Chrome Web Store fica fora do app", () => {
  const bitwarden =
    "https://chromewebstore.google.com/detail/bitwarden-password-manager/nngceckbapebfimnlniiiahkandclblb";

  it("reconhece a loja, o endereço antigo e o link embrulhado", () => {
    expect(isChromeWebStoreUrl(bitwarden)).toBe(true);
    expect(isChromeWebStoreUrl("https://chromewebstore.google.com/")).toBe(true);
    expect(isChromeWebStoreUrl("https://chrome.google.com/webstore/detail/x/abc")).toBe(true);
    expect(
      isChromeWebStoreUrl(`https://www.google.com/url?q=${encodeURIComponent(bitwarden)}`),
    ).toBe(true);
  });

  it("não pega outras páginas do Google nem de extensões", () => {
    expect(isChromeWebStoreUrl("https://www.google.com/search?q=chromewebstore")).toBe(false);
    expect(isChromeWebStoreUrl("https://chrome.google.com/")).toBe(false);
    expect(isChromeWebStoreUrl("https://bitwarden.com/download/")).toBe(false);
    expect(isChromeWebStoreUrl("lixo")).toBe(false);
  });

  it("link e janela da loja vão para o navegador externo em qualquer serviço", () => {
    expect(shouldOpenServiceUrlExternally("browser", bitwarden)).toBe(true);
    expect(servicePopupDisposition("browser", bitwarden, "foreground-tab")).toBe("external");
    expect(servicePopupDisposition("browser", bitwarden, "new-window")).toBe("external");
    expect(servicePopupDisposition("notion", bitwarden, "new-window")).toBe("external");
  });

  it("aba restaurada não volta para a loja", () => {
    expect(browserRestoreUrl("https://www.google.com/", bitwarden)).toBe(
      "https://www.google.com/",
    );
  });
});

describe("Outlook e Teams (conta pessoal, cloud.microsoft, links de reunião)", () => {
  it("live.com e cloud.microsoft contam como a casa do Outlook/Teams", () => {
    const outlook = "https://outlook.office.com/mail/";
    expect(serviceDriftedOffSite("outlook", "https://outlook.live.com/mail/0/", outlook)).toBe(false);
    expect(serviceDriftedOffSite("outlook", "https://outlook.cloud.microsoft/mail/", outlook)).toBe(false);
    expect(serviceDriftedOffSite("teams", "https://teams.live.com/v2/", "https://teams.microsoft.com/")).toBe(false);
    expect(serviceDriftedOffSite("outlook", "https://docs.google.com/", outlook)).toBe(true);
    // A casa do Teams não vale para o Outlook.
    expect(serviceDriftedOffSite("outlook", "https://teams.live.com/", outlook)).toBe(true);
  });

  it("reconhece link de reunião do Teams e só ele", () => {
    expect(isTeamsMeetingUrl("https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0")).toBe(true);
    expect(isTeamsMeetingUrl("https://teams.live.com/meet/9876543210")).toBe(true);
    expect(isTeamsMeetingUrl("https://teams.microsoft.com/v2/")).toBe(false);
    expect(isTeamsMeetingUrl("http://teams.microsoft.com/l/meetup-join/x")).toBe(false);
    expect(isTeamsMeetingUrl("https://teams.microsoft.com.evil.example/l/meetup-join/x")).toBe(false);
  });

  it("Safe Links: reconhece a reunião do Teams, mas link comum segue embrulhado (Defender)", () => {
    const safe = (target: string) =>
      `https://nam12.safelinks.protection.outlook.com/?url=${encodeURIComponent(target)}&data=05%7C02`;
    const meeting = "https://teams.microsoft.com/l/meetup-join/abc";
    expect(teamsMeetingTarget(safe(meeting))).toBe(meeting);
    expect(teamsMeetingTarget(`https://www.google.com/url?q=${encodeURIComponent(meeting)}`)).toBe(meeting);
    expect(teamsMeetingTarget(safe("https://evil.example/"))).toBeNull();
    // Abrir no navegador recebe a URL embrulhada: o Defender checa o clique.
    expect(unwrapRedirectUrl(safe("https://evil.example/"))).toBe(safe("https://evil.example/"));
  });

  it("outlook.office365.com é casa do Outlook em todas as regras", () => {
    const outlook = "https://outlook.office.com/mail/";
    expect(outlookHomeFor("https://outlook.office365.com/mail/inbox")).toBe("https://outlook.office365.com/mail/");
    expect(serviceDriftedOffSite("outlook", "https://outlook.office365.com/mail/", outlook)).toBe(false);
  });
});

describe("outlookHomeFor", () => {
  it("guarda a caixa de entrada onde a conta chegou", () => {
    expect(outlookHomeFor("https://outlook.live.com/mail/0/inbox")).toBe("https://outlook.live.com/mail/");
    expect(outlookHomeFor("https://outlook.office.com/mail/")).toBe("https://outlook.office.com/mail/");
    expect(outlookHomeFor("https://outlook.cloud.microsoft/mail/id/x")).toBe("https://outlook.cloud.microsoft/mail/");
  });

  it("ignora login, outras páginas e outros sites", () => {
    expect(outlookHomeFor("https://login.microsoftonline.com/common/oauth2/v2.0/authorize")).toBeNull();
    expect(outlookHomeFor("https://outlook.live.com/calendar/")).toBeNull();
    expect(outlookHomeFor("https://outlook.live.com.evil.example/mail/")).toBeNull();
    expect(outlookHomeFor("http://outlook.live.com/mail/")).toBeNull();
    expect(outlookHomeFor("lixo")).toBeNull();
  });
});
