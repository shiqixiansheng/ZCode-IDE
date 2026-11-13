import * as vscode from "vscode";
import { AgentProcessManager } from "./agentProcessManager";
import { ZCodeSidebarProvider } from "./sidebarProvider";

export function activate(context: vscode.ExtensionContext): void {
  const startupTimeoutMs =
    vscode.workspace.getConfiguration("zcode").get<number>("agentStartupTimeoutMs") ?? 30_000;
  const processes = new AgentProcessManager(startupTimeoutMs);
  const provider = new ZCodeSidebarProvider(context.extensionUri, processes);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ZCodeSidebarProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("zcode.toggleChatFocus", () => provider.toggleFocus()),
    vscode.commands.registerCommand("zcode.startNewConversation", () =>
      provider.startNewConversation(),
    ),
    vscode.commands.registerCommand("zcode.stopAgent", () => provider.stopAgent()),
    {
      dispose: () => {
        provider.dispose();
        processes.disposeAll();
      },
    },
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      // 换根目录时丢掉旧进程，下次发送再按新 folder spawn。
      processes.disposeAll();
    }),
  );
}

export function deactivate(): void {
  // disposables on context handle teardown
}
