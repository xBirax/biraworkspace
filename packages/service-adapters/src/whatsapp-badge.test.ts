import { describe, expect, it } from "vitest";
import { unreadFromWhatsAppTitle } from "./whatsapp-badge.js";
import { updateWhatsAppBadge } from "./whatsapp-instances.js";

describe("unreadFromWhatsAppTitle", () => {
  it("reads leading (N)", () => {
    expect(unreadFromWhatsAppTitle("(3) João | WhatsApp")).toBe(3);
    expect(unreadFromWhatsAppTitle("(12) WhatsApp")).toBe(12);
    expect(unreadFromWhatsAppTitle("WhatsApp")).toBe(0);
  });
});

describe("updateWhatsAppBadge", () => {
  it("upserts and clears", () => {
    let badges = updateWhatsAppBadge([], "a", 2);
    expect(badges).toEqual([{ serviceId: "a", unread: 2 }]);
    badges = updateWhatsAppBadge(badges, "a", 0);
    expect(badges).toEqual([]);
  });
});
