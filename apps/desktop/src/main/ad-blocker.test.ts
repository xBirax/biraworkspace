import { describe, expect, it } from "vitest";
import {
  hostnameFromUrl,
  hostnameMatchesFilter,
  isFirstPartyRequest,
  parseNetworkFilterDomains,
} from "./ad-blocker.js";

describe("Bira Browser ad blocker", () => {
  it("extracts supported EasyList network domains and ignores exceptions", () => {
    const filters = parseNetworkFilterDomains(`
      ! comment
      ||doubleclick.net^
      ||ads.example.com^$third-party
      @@||allowed.example.com^
      example.com##.banner
    `);

    expect(filters).toEqual(new Set(["doubleclick.net", "ads.example.com"]));
  });

  it("matches a domain and its subdomains without matching lookalikes", () => {
    const filters = new Set(["doubleclick.net"]);
    expect(hostnameMatchesFilter("ad.doubleclick.net", filters)).toBe(true);
    expect(hostnameMatchesFilter("doubleclick.net", filters)).toBe(true);
    expect(hostnameMatchesFilter("notdoubleclick.net", filters)).toBe(false);
  });

  it("ignores site-scoped rules instead of blocking them everywhere", () => {
    const filters = parseNetworkFilterDomains(`
      ||cdn.example.com^$domain=outrosite.com
      ||tracker.example.com^$third-party
    `);

    expect(filters).toEqual(new Set(["tracker.example.com"]));
  });

  it("treats the page's own domain and its subdomains as first-party", () => {
    expect(isFirstPartyRequest("web.whatsapp.com", "web.whatsapp.com")).toBe(true);
    expect(isFirstPartyRequest("whatsapp.com", "static.whatsapp.com")).toBe(true);
    expect(isFirstPartyRequest("web.whatsapp.com", "whatsapp.com")).toBe(true);
    expect(isFirstPartyRequest("web.whatsapp.com", "mmg.whatsapp.net")).toBe(false);
    expect(isFirstPartyRequest("", "doubleclick.net")).toBe(false);
  });

  it("extracts only valid URL hostnames", () => {
    expect(hostnameFromUrl("https://www.example.com/path")).toBe("www.example.com");
    expect(hostnameFromUrl("not a url")).toBe("");
  });
});
