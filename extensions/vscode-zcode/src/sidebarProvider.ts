import * as vscode from "vscode";
import { AgentProcessManager, resolveAgentEntry } from "./agentProcessManager";
import { SidebarSessionController } from "./sessionController";

type WebviewToHost =
  | { type: "ready" }
  | { type: "send"; text: string }
  | { type: "stop" }
  | { type: "newConversation" };

/**
 * Antigravity-shaped chat webview: sessions list chrome + composer + local agent status.
 */
export class ZCodeSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "zcode.sidebar";

  private view?: vscode.WebviewView;
  private controller?: SidebarSessionController;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly processes: AgentProcessManager,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.renderHtml(webviewView.webview);

    this.disposables.push(
      webviewView.webview.onDidReceiveMessage(async (message: WebviewToHost) => {
        try {
          await this.onMessage(message);
        } catch (error) {
          this.post({
            type: "status",
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );

    void this.bootstrap();
  }

  async toggleFocus(): Promise<void> {
    await vscode.commands.executeCommand("zcode.sidebar.focus");
  }

  async startNewConversation(): Promise<void> {
    const controller = await this.ensureController();
    if (!controller) return;
    await controller.startNewConversation();
    this.post({ type: "status", kind: "info", message: "已开始新会话" });
  }

  async stopAgent(): Promise<void> {
    if (!this.controller) return;
    await this.controller.stop();
  }

  dispose(): void {
    this.controller?.dispose();
    for (const d of this.disposables) d.dispose();
  }

  private async bootstrap(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      this.post({
        type: "status",
        kind: "error",
        message: "请先打开一个工作区文件夹，再使用 ZCode 侧栏。",
      });
      return;
    }
    this.post({
      type: "status",
      kind: "info",
      message: "本地 · Default permissions（zcode app-server）",
    });
    await this.ensureController();
  }

  private async ensureController(): Promise<SidebarSessionController | null> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      this.post({
        type: "status",
        kind: "error",
        message: "请先打开一个工作区文件夹，再使用 ZCode 侧栏。",
      });
      return null;
    }
    if (this.controller) return this.controller;

    const config = vscode.workspace.getConfiguration("zcode");
    const entry = resolveAgentEntry({
      configuredEntry: config.get<string>("agentEntry") ?? "",
      searchFrom: folder.uri.fsPath,
    });
    const workspacePath = folder.uri.fsPath;
    const controller = new SidebarSessionController(workspacePath, () =>
      this.processes.getClient(workspacePath, entry),
    );
    controller.onFrame((view) => this.post({ type: "snapshot", view }));
    controller.onStatus((status) =>
      this.post({ type: "status", kind: status.kind, message: status.message }),
    );
    this.controller = controller;
    return controller;
  }

  private async onMessage(message: WebviewToHost): Promise<void> {
    if (message.type === "ready") {
      await this.bootstrap();
      return;
    }
    const controller = await this.ensureController();
    if (!controller) return;
    if (message.type === "send") {
      await controller.sendText(message.text);
      return;
    }
    if (message.type === "stop") {
      await controller.stop();
      return;
    }
    if (message.type === "newConversation") {
      await controller.startNewConversation();
    }
  }

  private post(payload: unknown): void {
    void this.view?.webview.postMessage(payload);
  }

  private renderHtml(webview: vscode.Webview): string {
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'unsafe-inline'`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ZCode</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: var(--vscode-sideBar-background);
      --fg: var(--vscode-foreground);
      --muted: var(--vscode-descriptionForeground);
      --border: var(--vscode-panel-border, rgba(128,128,128,.35));
      --input: var(--vscode-input-background);
      --button: var(--vscode-button-background);
      --button-fg: var(--vscode-button-foreground);
      --accent: var(--vscode-textLink-foreground);
    }
    html, body { height: 100%; margin: 0; }
    body {
      display: flex; flex-direction: column;
      font: 13px/1.45 var(--vscode-font-family);
      color: var(--fg); background: var(--bg);
    }
    header {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; border-bottom: 1px solid var(--border);
    }
    header .tabs { display: flex; gap: 6px; flex: 1; min-width: 0; }
    header .tab {
      border: 0; background: transparent; color: var(--muted);
      padding: 4px 8px; border-radius: 6px; cursor: default;
    }
    header .tab.active { color: var(--fg); background: color-mix(in srgb, var(--fg) 12%, transparent); }
    header button.icon {
      border: 0; background: transparent; color: var(--fg); cursor: pointer; padding: 4px 6px;
    }
    .sessions {
      padding: 8px 10px; border-bottom: 1px solid var(--border); color: var(--muted);
    }
    .sessions h2 { margin: 0 0 4px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
    #sessionLabel { color: var(--fg); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #log {
      flex: 1; overflow: auto; padding: 12px 10px; display: flex; flex-direction: column; gap: 10px;
    }
    .row { max-width: 100%; }
    .row .role { font-size: 11px; color: var(--muted); margin-bottom: 2px; }
    .row .bubble {
      white-space: pre-wrap; word-break: break-word;
      padding: 8px 10px; border-radius: 8px;
      background: color-mix(in srgb, var(--fg) 8%, transparent);
      border: 1px solid var(--border);
    }
    .row.user .bubble { border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }
    .hint { color: var(--accent); font-size: 12px; padding: 0 10px 8px; }
    .composer {
      border-top: 1px solid var(--border); padding: 10px; display: flex; flex-direction: column; gap: 8px;
    }
    textarea {
      width: 100%; min-height: 72px; resize: vertical; box-sizing: border-box;
      background: var(--input); color: var(--fg); border: 1px solid var(--border);
      border-radius: 8px; padding: 8px 10px; font: inherit;
    }
    .toolbar { display: flex; gap: 8px; align-items: center; }
    .toolbar .meta { flex: 1; color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .toolbar button {
      border: 0; border-radius: 6px; padding: 6px 12px; cursor: pointer;
      background: var(--button); color: var(--button-fg);
    }
    .toolbar button.secondary { background: transparent; color: var(--fg); border: 1px solid var(--border); }
    #status { padding: 6px 10px 10px; color: var(--muted); font-size: 11px; border-top: 1px solid var(--border); }
    #status.error { color: var(--vscode-errorForeground); }
  </style>
</head>
<body>
  <header>
    <div class="tabs">
      <span class="tab active">ZCode</span>
    </div>
    <button class="icon" id="btnNew" title="新会话">+</button>
  </header>
  <div class="sessions">
    <h2>会话</h2>
    <div id="sessionLabel">尚未创建</div>
  </div>
  <div id="log"></div>
  <div class="hint">提示：后端是本地 zcode app-server（stdio），壳层参考 Antigravity 侧栏形态。</div>
  <div class="composer">
    <textarea id="input" placeholder="描述要构建的内容"></textarea>
    <div class="toolbar">
      <span class="meta" id="agentMeta">&lt;/&gt; Agent · Local zcode</span>
      <button class="secondary" id="btnStop">Stop</button>
      <button id="btnSend">发送</button>
    </div>
  </div>
  <div id="status">就绪</div>
  <script>
    const vscode = acquireVsCodeApi();
    const log = document.getElementById('log');
    const input = document.getElementById('input');
    const statusEl = document.getElementById('status');
    const sessionLabel = document.getElementById('sessionLabel');

    function setStatus(kind, message) {
      statusEl.textContent = message;
      statusEl.className = kind === 'error' ? 'error' : '';
    }

    function renderSnapshot(view) {
      sessionLabel.textContent = view.sessionId || '未知会话';
      log.innerHTML = '';
      for (const row of view.rows || []) {
        const el = document.createElement('div');
        el.className = 'row ' + (row.role || '');
        el.innerHTML = '<div class="role"></div><div class="bubble"></div>';
        el.querySelector('.role').textContent = row.role;
        el.querySelector('.bubble').textContent = row.text || '';
        log.appendChild(el);
      }
      log.scrollTop = log.scrollHeight;
    }

    document.getElementById('btnSend').addEventListener('click', () => {
      const text = input.value;
      if (!text.trim()) return;
      vscode.postMessage({ type: 'send', text });
      input.value = '';
    });
    document.getElementById('btnStop').addEventListener('click', () => {
      vscode.postMessage({ type: 'stop' });
    });
    document.getElementById('btnNew').addEventListener('click', () => {
      vscode.postMessage({ type: 'newConversation' });
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        document.getElementById('btnSend').click();
      }
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'snapshot') renderSnapshot(msg.view);
      if (msg.type === 'status') setStatus(msg.kind, msg.message);
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
