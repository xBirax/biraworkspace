import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createTaskbarBadgePng, describeTaskbarBadge } from "./taskbar-badge.js";

describe("Windows taskbar badge", () => {
  it("clears for zero and disabled totals", () => {
    expect(createTaskbarBadgePng(0)).toBeNull();
    expect(createTaskbarBadgePng(-1)).toBeNull();
    expect(createTaskbarBadgePng(Number.NaN)).toBeNull();
    expect(describeTaskbarBadge(0)).toBe("Sem mensagens não lidas");
  });

  it("renders a transparent 16×16 PNG for ordinary unread totals", () => {
    const png = createTaskbarBadgePng(7);
    expect(png?.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png?.readUInt32BE(16)).toBe(16);
    expect(png?.readUInt32BE(20)).toBe(16);
    expect(inflateSync(png!.subarray(41, -16))).toHaveLength(16 * (16 * 4 + 1));
    expect(describeTaskbarBadge(1)).toBe("1 mensagem não lida");
    expect(describeTaskbarBadge(7)).toBe("7 mensagens não lidas");
  });

  it("caps the visible taskbar counter at 99+", () => {
    const png = createTaskbarBadgePng(100);
    expect(png).not.toBeNull();
    expect(describeTaskbarBadge(131)).toBe("99+ mensagens não lidas");
  });
});
