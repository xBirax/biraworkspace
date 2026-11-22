import { describe, expect, it } from "vitest";
import {
  googleGisPopupOrigin,
  googleOAuthRedirectUri,
  isGoogleOAuthCallback,
  isServiceOAuthRedirect,
  microsoftOAuthStart,
  oauthPostPrefix,
  oauthStart,
} from "./chrome-session.js";

const REDIRECT = "https://auth.openai.com/api/accounts/callback/google";
const oauth = (path: string, redirect = REDIRECT) =>
  `https://accounts.google.com${path}?client_id=abc.apps.googleusercontent.com&response_type=code&state=s1&redirect_uri=${encodeURIComponent(redirect)}`;

describe("googleOAuthRedirectUri", () => {
  it.each(["/o/oauth2/v2/auth", "/o/oauth2/auth", "/signin/oauth"])(
    "reconhece o começo do fluxo OAuth em %s",
    (path) => {
      expect(googleOAuthRedirectUri(oauth(path))).toBe(REDIRECT);
    },
  );

  it.each([
    "https://accounts.google.com/v3/signin/identifier",
    "https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=https%3A%2F%2Fauth.openai.com%2Fcb",
    "https://accounts.google.com/o/oauth2/v2/auth?client_id=x",
    "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=postmessage",
    "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=http%3A%2F%2Fexample.com%2Fcb",
    "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fmail.google.com%2Fcb",
    "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fu%3Ap%40example.com%2Fcb",
    "https://example.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fauth.openai.com%2Fcb",
    "http://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fauth.openai.com%2Fcb",
    "https://accounts.google.com.example.org/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fauth.openai.com%2Fcb",
    `${oauth("/o/oauth2/v2/auth")}&prompt=none`,
    `${oauth("/o/oauth2/v2/auth")}&response_mode=form_post`,
    "not a url",
  ])("ignora o que não é início de OAuth seguro: %s", (url) => {
    expect(googleOAuthRedirectUri(url)).toBeNull();
  });
});

describe("googleGisPopupOrigin", () => {
  // Como o TikTok abre o "Continuar com Google" (Google Identity Services).
  const gis = (origin: string) =>
    `https://accounts.google.com/o/oauth2/v2/auth?gsiwebsdk=gis_attributes&client_id=1.apps.googleusercontent.com&redirect_uri=gis_transform&prompt=select_account&response_type=token&origin=${encodeURIComponent(origin)}&display=popup&response_mode=form_post`;

  it("devolve a origem do site que pediu o login", () => {
    expect(googleGisPopupOrigin(gis("https://www.tiktok.com"))).toBe("https://www.tiktok.com");
  });

  it.each([
    gis("http://www.tiktok.com"),
    gis("https://u:p@www.tiktok.com"),
    gis("https://accounts.google.com"),
    gis("https://www.tiktok.com").replace("prompt=select_account", "prompt=none"),
    gis("nada"),
    oauth("/o/oauth2/v2/auth"),
    gis("https://www.tiktok.com").replace("accounts.google.com", "accounts.google.com.evil.example"),
    gis("https://www.tiktok.com").replace("/o/oauth2/v2/auth", "/gsi/transform"),
    gis("https://www.tiktok.com").replace("client_id=1.apps.googleusercontent.com&", ""),
  ])("ignora o que não é popup GIS seguro: %s", (url) => {
    expect(googleGisPopupOrigin(url)).toBeNull();
  });

  it("só o TikTok pode receber login pela origem dele", () => {
    expect(isServiceOAuthRedirect("tiktok", "https://www.tiktok.com")).toBe(true);
    expect(isServiceOAuthRedirect("notion", "https://www.tiktok.com")).toBe(false);
  });
});

describe("isGoogleOAuthCallback", () => {
  it("aceita o redirect_uri com code/state na query", () => {
    expect(isGoogleOAuthCallback(`${REDIRECT}?code=1&state=s1`, REDIRECT)).toBe(true);
  });

  it.each([
    "https://accounts.google.com/signin/oauth/consent",
    "https://auth.openai.com/api/accounts/callback/other?code=1",
    "https://auth.openai.com.evil.example/api/accounts/callback/google?code=1",
    "http://auth.openai.com/api/accounts/callback/google?code=1",
    "not a url",
  ])("não confunde outras páginas com o retorno: %s", (url) => {
    expect(isGoogleOAuthCallback(url, REDIRECT)).toBe(false);
  });
});

describe("isServiceOAuthRedirect", () => {
  it.each([
    ["chatgpt", REDIRECT],
    ["chatgpt", "https://chatgpt.com/api/auth/callback/google"],
    ["notion", "https://www.notion.so/googlepopupredirect"],
    ["trello", "https://id.atlassian.com/login/callback"],
    ["tiktok", "https://www.tiktok.com/login/google/callback"],
  ])("aceita o retorno do próprio serviço: %s → %s", (kind, uri) => {
    expect(isServiceOAuthRedirect(kind, uri)).toBe(true);
  });

  it.each([
    ["chatgpt", "https://evil.example/cb"],
    ["chatgpt", "https://openai.com.evil.example/cb"],
    ["claude", REDIRECT],
    ["gmail", REDIRECT],
    ["chatgpt", "not a url"],
  ])("recusa retorno de outro site: %s → %s", (kind, uri) => {
    expect(isServiceOAuthRedirect(kind, uri)).toBe(false);
  });
});

describe("microsoftOAuthStart / oauthStart", () => {
  const ms = (host: string, path: string, extra = "") =>
    `https://${host}${path}?client_id=abc&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT)}${extra}`;

  it.each([
    ["login.microsoftonline.com", "/common/oauth2/v2.0/authorize"],
    ["login.microsoftonline.com", "/consumers/oauth2/authorize"],
    ["login.live.com", "/oauth20_authorize.srf"],
  ])("reconhece o começo do login Microsoft em %s%s", (host, path) => {
    expect(microsoftOAuthStart(ms(host, path))).toEqual({ redirectUri: REDIRECT, formPost: false });
    expect(oauthStart(ms(host, path))).toEqual({ provider: "microsoft", returnTo: REDIRECT, mode: "redirect" });
  });

  it("form_post volta num POST ao redirect_uri", () => {
    const url = ms("login.microsoftonline.com", "/common/oauth2/v2.0/authorize", "&response_mode=form_post");
    expect(oauthStart(url)).toEqual({ provider: "microsoft", returnTo: REDIRECT, mode: "form_post" });
  });

  it.each([
    ms("login.microsoftonline.com", "/common/oauth2/v2.0/authorize", "&prompt=none"),
    ms("login.microsoftonline.com", "/common/oauth2/v2.0/logout"),
    ms("login.microsoftonline.com.evil.example", "/common/oauth2/v2.0/authorize"),
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc&redirect_uri=http%3A%2F%2Fexample.com%2Fcb",
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc&redirect_uri=https%3A%2F%2Flogin.live.com%2Fcb",
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?redirect_uri=https%3A%2F%2Fauth.openai.com%2Fcb",
    "http://login.live.com/oauth20_authorize.srf?client_id=abc&redirect_uri=https%3A%2F%2Fauth.openai.com%2Fcb",
  ])("ignora o que não é início de login Microsoft seguro: %s", (url) => {
    expect(microsoftOAuthStart(url)).toBeNull();
  });

  it("Google continua com prioridade e o mesmo formato", () => {
    expect(oauthStart(oauth("/o/oauth2/v2/auth"))).toEqual({ provider: "google", returnTo: REDIRECT, mode: "redirect" });
    expect(oauthStart("https://example.com/")).toBeNull();
  });
});

describe("oauthPostPrefix", () => {
  it("GIS pega o /gsi/transform; form_post pega o redirect_uri sem query", () => {
    expect(oauthPostPrefix({ provider: "google", returnTo: "https://www.tiktok.com", mode: "gis" })).toBe(
      "https://accounts.google.com/gsi/transform",
    );
    expect(
      oauthPostPrefix({ provider: "microsoft", returnTo: `${REDIRECT}?x=1#y`, mode: "form_post" }),
    ).toBe(REDIRECT);
  });
});
