import { useZCodeStore, useZCodeStoreWithDefault } from "@/store/StoreProvider.js";
import {
  DEFAULT_WORKSPACE_SHELL_LAYOUT_MODE,
  type WorkspaceShellLayoutMode,
} from "@/lib/workspaceShellLayoutMode.js";

export function useWorkspaceShellLayoutMode(): WorkspaceShellLayoutMode {
  return useZCodeStoreWithDefault(
    (state) => state.workspaceShellLayoutMode,
    DEFAULT_WORKSPACE_SHELL_LAYOUT_MODE,
  );
}

export function useSetWorkspaceShellLayoutMode(): (mode: WorkspaceShellLayoutMode) => void {
  return useZCodeStore((state) => state.setWorkspaceShellLayoutMode);
}
