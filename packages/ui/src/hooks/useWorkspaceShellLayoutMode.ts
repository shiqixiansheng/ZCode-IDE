import { useZCodeStore, useZCodeStoreWithDefault } from "@/store/StoreProvider.js";
import type { WorkspaceShellLayoutMode } from "@/lib/workspaceShellLayoutMode.js";

export function useWorkspaceShellLayoutMode(): WorkspaceShellLayoutMode {
  return useZCodeStoreWithDefault((state) => state.workspaceShellLayoutMode, "agent-primary");
}

export function useSetWorkspaceShellLayoutMode(): (mode: WorkspaceShellLayoutMode) => void {
  return useZCodeStore((state) => state.setWorkspaceShellLayoutMode);
}
