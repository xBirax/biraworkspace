import { describe, expect, it } from "vitest";
import { isGoogleLoginRejectionUrl } from "./chrome-session.js";

describe("Google login rejection diagnostics", () => {
  it.each([
    "https://accounts.google.com/signin/rejected",
    "https://accounts.google.com/v3/signin/rejected?rrk=example",
    "https://accounts.google.com/lifecycle/steps/signin/rejected?continue=https%3A%2F%2Fmail.google.com",
    "https://accounts.google.com/v3/signin/rejected/",
  ])("recognizes an Accounts rejection route: %s", (url) => {
    expect(isGoogleLoginRejectionUrl(url)).toBe(true);
  });

  it.each([
    "https://accounts.google.com/v3/signin/identifier",
    "https://accounts.google.com/signin/v2/challenge/pwd",
    "https://accounts.google.com/signin?continue=https://example.com/signin/rejected",
    "https://accounts.google.com/signin?browserorapp=1",
    "https://accounts.google.com/signin/rejected-example",
    "https://mail.google.com/mail/u/0/#search/browserorapp",
    "https://example.com/signin/rejected",
    "https://accounts.google.com.example.org/signin/rejected",
    "https://accounts.google.com@evil.example/signin/rejected",
    "http://accounts.google.com/signin/rejected",
    "data:text/html,browserorapp",
    "not a url",
  ])("does not mislabel other content or login steps: %s", (url) => {
    expect(isGoogleLoginRejectionUrl(url)).toBe(false);
  });
});
