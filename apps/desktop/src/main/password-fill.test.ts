import { describe, expect, it } from "vitest";
import { buildPasswordFillScript } from "./password-fill.js";

describe("password fill script", () => {
  it("pins filling to the expected origin and never submits the form", () => {
    const script = buildPasswordFillScript(
      "https://example.com",
      'u"; globalThis.pwned = true; //',
      "secret",
    );
    expect(script).toContain("location.origin !== credential.expectedOrigin");
    expect(script).not.toContain(".submit(");
    expect(script).not.toContain("requestSubmit");
    expect(script).toContain(JSON.stringify('u"; globalThis.pwned = true; //'));
  });
});
