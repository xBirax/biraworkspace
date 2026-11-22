import { describe, expect, it } from "vitest";
import { ViewLifecycle, canDestroyWebContents } from "../src/index.js";

describe("view lifecycle", () => {
  it("covers required transitions", () => {
    const life = new ViewLifecycle();
    expect(life.state).toBe("not_created");
    life.transition("loading");
    life.transition("active");
    life.transition("background");
    life.transition("suspended");
    life.transition("loading");
    life.transition("failed");
    expect(canDestroyWebContents("suspended")).toBe(true);
  });

  it("rejects illegal transitions", () => {
    const life = new ViewLifecycle();
    expect(() => life.transition("active")).toThrow(/inválida/);
  });
});
