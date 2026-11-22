import { describe, expect, it } from "vitest";
import { calculateWorkspaceLayout } from "./workspace-layout.js";

describe("calculateWorkspaceLayout", () => {
  it.each([
    [
      "left",
      {
        sidebar: { x: 0, y: 36, width: 68, height: 764 },
        main: { x: 68, y: 36, width: 1132, height: 764 },
      },
    ],
    [
      "right",
      {
        sidebar: { x: 1132, y: 36, width: 68, height: 764 },
        main: { x: 0, y: 36, width: 1132, height: 764 },
      },
    ],
    [
      "top",
      {
        sidebar: { x: 0, y: 36, width: 1200, height: 68 },
        main: { x: 0, y: 104, width: 1200, height: 696 },
      },
    ],
    [
      "bottom",
      {
        sidebar: { x: 0, y: 732, width: 1200, height: 68 },
        main: { x: 0, y: 36, width: 1200, height: 696 },
      },
    ],
  ] as const)("places the sidebar on %s", (position, expected) => {
    expect(calculateWorkspaceLayout(1200, 800, position, 36, 68)).toEqual(expected);
  });
});
