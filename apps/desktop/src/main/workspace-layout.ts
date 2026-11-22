import type { Rectangle } from "electron";
import type { SidebarPosition } from "@adr/contracts";

export type WorkspaceLayout = {
  sidebar: Rectangle;
  main: Rectangle;
};

export function calculateWorkspaceLayout(
  width: number,
  height: number,
  sidebarPosition: SidebarPosition,
  titlebarPx: number,
  sidebarPx: number,
): WorkspaceLayout {
  const bodyHeight = Math.max(height - titlebarPx, 0);
  const horizontal = sidebarPosition === "top" || sidebarPosition === "bottom";
  const mainWidth = Math.max(width - (horizontal ? 0 : sidebarPx), 0);
  const mainHeight = Math.max(bodyHeight - (horizontal ? sidebarPx : 0), 0);

  if (sidebarPosition === "right") {
    return {
      sidebar: { x: mainWidth, y: titlebarPx, width: sidebarPx, height: bodyHeight },
      main: { x: 0, y: titlebarPx, width: mainWidth, height: bodyHeight },
    };
  }
  if (sidebarPosition === "top") {
    return {
      sidebar: { x: 0, y: titlebarPx, width, height: sidebarPx },
      main: { x: 0, y: titlebarPx + sidebarPx, width, height: mainHeight },
    };
  }
  if (sidebarPosition === "bottom") {
    return {
      sidebar: { x: 0, y: titlebarPx + mainHeight, width, height: sidebarPx },
      main: { x: 0, y: titlebarPx, width, height: mainHeight },
    };
  }
  return {
    sidebar: { x: 0, y: titlebarPx, width: sidebarPx, height: bodyHeight },
    main: { x: sidebarPx, y: titlebarPx, width: mainWidth, height: bodyHeight },
  };
}
