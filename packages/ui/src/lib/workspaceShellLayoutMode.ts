/**
 * 壳层列拓扑偏好。与 interfaceMode（办公/编程信息密度）正交。
 * 见 docs/ui/cursor-ide-layout-mode.md。
 */
export type WorkspaceShellLayoutMode = "agent-primary" | "ide";

export const WORKSPACE_SHELL_LAYOUT_MODE_STORAGE_KEY = "zcode-workspace-shell-layout-mode";

export function normalizeWorkspaceShellLayoutMode(value: unknown): WorkspaceShellLayoutMode {
  return value === "ide" ? "ide" : "agent-primary";
}

/** 一次打开文件只落一个表面。扩展查看器可强制侧栏。 */
export type FileOpenSurface = "side-pane" | "primary-preview";

export function resolveFileOpenSurface(
  layoutMode: WorkspaceShellLayoutMode,
  request?: { preferSidePane?: boolean },
): FileOpenSurface {
  if (request?.preferSidePane) return "side-pane";
  return layoutMode === "ide" ? "primary-preview" : "side-pane";
}

/**
 * 手机远控保持 agent-primary 列。本地存储里的 ide 不单独改远控壳。
 */
export function isWorkspaceIdeShellActive(input: {
  layoutMode: WorkspaceShellLayoutMode;
  isDesktop: boolean;
  isWebRemoteControlShell: boolean;
}): boolean {
  return input.layoutMode === "ide" && input.isDesktop && !input.isWebRemoteControlShell;
}
