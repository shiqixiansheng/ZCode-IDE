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
        message: "请先打开一个工作区文件夹，再使用 TinyZhuIDE 侧栏。",
      });
      return;
    }
    this.post({
      type: "status",
      kind: "info",
      message: "本地 · Default permissions（TinyZhuIDE · zcode app-server）",
    });
    await this.ensureController();
  }

  private async ensureController(): Promise<SidebarSessionController | null> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      this.post({
        type: "status",
        kind: "error",
        message: "请先打开一个工作区文件夹，再使用 TinyZhuIDE 侧栏。",
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

    // Antigravity agent-panel cues: brand tab, quiet session strip, bubbles, bottom composer + Agent chip.
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TinyZhuIDE</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: var(--vscode-sideBar-background);
      --fg: var(--vscode-foreground);
      --muted: var(--vscode-descriptionForeground);
      --border: color-mix(in srgb, var(--vscode-panel-border, #888) 55%, transparent);
      --input: var(--vscode-input-background);
      --button: var(--vscode-button-background);
      --button-fg: var(--vscode-button-foreground);
      --accent: var(--vscode-focusBorder, var(--vscode-textLink-foreground));
      --chip: color-mix(in srgb, var(--fg) 9%, transparent);
      --user-bg: color-mix(in srgb, var(--accent) 14%, transparent);
      --assistant-bg: color-mix(in srgb, var(--fg) 6%, transparent);
      --radius: 12px;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body {
      display: flex; flex-direction: column;
      font: 13px/1.5 var(--vscode-font-family);
      color: var(--fg); background: var(--bg);
    }
    header {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px 8px; border-bottom: 1px solid var(--border);
    }
    .brand {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 5px 10px; border-radius: 999px; background: var(--chip);
      font-weight: 600; letter-spacing: .01em;
    }
    .brand .dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
    }
    .spacer { flex: 1; }
    header button.icon {
      width: 28px; height: 28px; border-radius: 8px; border: 0;
      background: transparent; color: var(--fg); cursor: pointer;
    }
    header button.icon:hover { background: var(--chip); }
    .sessions {
      margin: 10px 12px 0; padding: 10px 12px; border-radius: var(--radius);
      background: var(--chip); border: 1px solid var(--border);
    }
    .sessions .label {
      margin: 0 0 4px; font-size: 10px; font-weight: 650;
      letter-spacing: .08em; text-transform: uppercase; color: var(--muted);
    }
    #sessionLabel {
      color: var(--fg); font-size: 12px; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap;
    }
    #log {
      flex: 1; overflow: auto; padding: 14px 12px 8px;
      display: flex; flex-direction: column; gap: 12px;
    }
    .empty {
      margin: auto; text-align: center; color: var(--muted); max-width: 220px;
      padding: 24px 8px;
    }
    .empty strong { display: block; color: var(--fg); font-size: 14px; margin-bottom: 6px; }
    .row { max-width: 100%; display: flex; flex-direction: column; gap: 4px; }
    .row.user { align-items: flex-end; }
    .row .role {
      font-size: 10px; letter-spacing: .04em; text-transform: uppercase;
      color: var(--muted); padding: 0 4px;
    }
    .row .bubble {
      white-space: pre-wrap; word-break: break-word;
      padding: 10px 12px; border-radius: 14px;
      background: var(--assistant-bg); border: 1px solid var(--border);
      max-width: 100%;
    }
    .row.user .bubble {
      background: var(--user-bg);
      border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
      border-bottom-right-radius: 4px;
    }
    .row.assistant .bubble { border-bottom-left-radius: 4px; }
    .row.tool .bubble {
      font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
      font-size: 12px; color: var(--muted);
    }
    .composer-wrap {
      padding: 8px 12px 12px; border-top: 1px solid var(--border);
      background: color-mix(in srgb, var(--bg) 92%, transparent);
    }
    .composer {
      display: flex; flex-direction: column; gap: 8px;
      padding: 10px; border-radius: 16px; border: 1px solid var(--border);
      background: var(--input);
      box-shadow: 0 8px 24px color-mix(in srgb, #000 12%, transparent);
    }
    textarea {
      width: 100%; min-height: 68px; max-height: 180px; resize: vertical;
      border: 0; outline: none; background: transparent; color: var(--fg);
      padding: 2px 4px; font: inherit;
    }
    .toolbar { display: flex; gap: 8px; align-items: center; }
    .chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px; border-radius: 999px; border: 1px solid var(--border);
      background: var(--chip); color: var(--fg); font-size: 11px; font-weight: 600;
    }
    .chip .code { opacity: .7; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
    .toolbar .meta { flex: 1; color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .toolbar button {
      border: 0; border-radius: 999px; padding: 6px 14px; cursor: pointer;
      background: var(--button); color: var(--button-fg); font-weight: 600;
    }
    .toolbar button.secondary {
      background: transparent; color: var(--fg); border: 1px solid var(--border);
    }
    #status {
      padding: 0 16px 10px; color: var(--muted); font-size: 11px;
    }
    #status.error { color: var(--vscode-errorForeground); }
  </style>
</head>
<body>
  <header>
    <div class="brand"><span class="dot"></span>TinyZhuIDE</div>
    <div class="spacer"></div>
    <button class="icon" id="btnNew" title="新会话">＋</button>
  </header>
  <div class="sessions">
    <div class="label">Conversation</div>
    <div id="sessionLabel">尚未创建</div>
  </div>
  <div id="log">
    <div class="empty" id="empty">
      <strong>开始构建</strong>
      像 Antigravity 一样在侧栏对话，由本地 zcode agent 执行。
    </div>
  </div>
  <div class="composer-wrap">
    <div class="composer">
      <textarea id="input" placeholder="描述要构建的内容…"></textarea>
      <div class="toolbar">
        <span class="chip"><span class="code">&lt;/&gt;</span> Agent</span>
        <span class="meta" id="agentMeta">Local · app-server</span>
        <button class="secondary" id="btnStop">Stop</button>
        <button id="btnSend">发送</button>
      </div>
    </div>
  </div>
  <div id="status">就绪</div>
  <script>
    const vscode = acquireVsCodeApi();
    const log = document.getElementById('log');
    const input = document.getElementById('input');
    const statusEl = document.getElementById('status');
    const sessionLabel = document.getElementById('sessionLabel');
    const emptyHtml = document.getElementById('empty')?.outerHTML || '';

    function setStatus(kind, message) {
      statusEl.textContent = message;
      statusEl.className = kind === 'error' ? 'error' : '';
    }

    function renderSnapshot(view) {
      sessionLabel.textContent = view.sessionId || '未知会话';
      const rows = view.rows || [];
      if (!rows.length) {
        log.innerHTML = emptyHtml;
        return;
      }
      log.innerHTML = '';
      for (const row of rows) {
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
