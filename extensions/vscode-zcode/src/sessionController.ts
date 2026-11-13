import { randomUUID } from "node:crypto";
import type { ProtocolClient, ProtocolNotification } from "./protocolClient";

export type ChatRow = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
};

export type SessionSnapshotView = {
  sessionId: string;
  phase?: string;
  rows: ChatRow[];
};

type FrameListener = (view: SessionSnapshotView) => void;
type StatusListener = (status: { kind: "info" | "error"; message: string }) => void;

function newCommandId(): string {
  // Desktop uses uuidv7; randomUUID is enough for MVP idempotency keys.
  return randomUUID();
}

function extractRows(snapshot: unknown): ChatRow[] {
  const root = snapshot as {
    rows?: { window?: Array<Record<string, unknown>> };
  } | null;
  const window = root?.rows?.window;
  if (!Array.isArray(window)) return [];
  const rows: ChatRow[] = [];
  for (const row of window) {
    const id = String(row.id ?? row.rowId ?? randomUUID());
    const type = String(row.type ?? row.kind ?? "");
    if (type === "userInput" || type === "user") {
      const text =
        typeof row.text === "string"
          ? row.text
          : typeof (row.content as { text?: string } | undefined)?.text === "string"
            ? (row.content as { text: string }).text
            : JSON.stringify(row.content ?? "");
      rows.push({ id, role: "user", text });
      continue;
    }
    if (type === "assistant" || type === "assistantMessage" || type === "message") {
      const parts = row.parts ?? row.content;
      let text = "";
      if (typeof parts === "string") text = parts;
      else if (Array.isArray(parts)) {
        text = parts
          .map((part) => {
            if (typeof part === "string") return part;
            if (part && typeof part === "object" && "text" in part) {
              return String((part as { text: unknown }).text ?? "");
            }
            return "";
          })
          .join("");
      } else if (parts && typeof parts === "object" && "text" in (parts as object)) {
        text = String((parts as { text: unknown }).text ?? "");
      }
      if (text) rows.push({ id, role: "assistant", text });
      continue;
    }
    if (type === "tool" || type === "toolCall") {
      const name = String(row.name ?? row.toolName ?? "tool");
      rows.push({ id, role: "tool", text: name });
    }
  }
  return rows;
}

/**
 * Owns session binding + V4 createSession/sendText/stop/subscribe for one sidebar.
 * Conversation truth stays in CLI projection frames.
 */
export class SidebarSessionController {
  private sessionId: string | null = null;
  private clientId = `vscode-${randomUUID()}`;
  private connectionId = `conn-${randomUUID()}`;
  private subscriptionId: string | null = null;
  private lastView: SessionSnapshotView | null = null;
  private readonly frameListeners = new Set<FrameListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private notificationHandler: ((n: ProtocolNotification) => void) | null = null;

  constructor(
    private readonly workspacePath: string,
    private readonly getClient: () => Promise<ProtocolClient>,
  ) {}

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    if (this.lastView) listener(this.lastView);
    return () => this.frameListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  async ensureSession(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    const client = await this.getClient();
    this.attachClient(client);
    const sessionId = `sess_${randomUUID()}`;
    const envelope = {
      commandId: newCommandId(),
      clientId: this.clientId,
      sessionId: null,
      type: "createSession",
      payload: {
        sessionId,
        workspaceId: this.workspacePath,
      },
      issuedAt: Date.now(),
    };
    await client.request("v4/command", envelope);
    this.sessionId = sessionId;
    await this.subscribe(client, sessionId);
    this.emitStatus("info", `会话已创建：${sessionId.slice(0, 12)}…`);
    return sessionId;
  }

  async startNewConversation(): Promise<string> {
    await this.unsubscribe();
    this.sessionId = null;
    this.lastView = null;
    return this.ensureSession();
  }

  async sendText(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    const sessionId = await this.ensureSession();
    const client = await this.getClient();
    this.attachClient(client);
    const envelope = {
      commandId: newCommandId(),
      clientId: this.clientId,
      sessionId,
      type: "sendText",
      payload: { text: trimmed },
      issuedAt: Date.now(),
    };
    await client.request("v4/command", envelope);
  }

  async stop(): Promise<void> {
    if (!this.sessionId) return;
    const client = await this.getClient();
    const envelope = {
      commandId: newCommandId(),
      clientId: this.clientId,
      sessionId: this.sessionId,
      type: "stop",
      payload: {},
      issuedAt: Date.now(),
    };
    await client.request("v4/command", envelope);
  }

  dispose(): void {
    void this.unsubscribe();
    this.frameListeners.clear();
    this.statusListeners.clear();
  }

  private attachClient(client: ProtocolClient): void {
    if (this.notificationHandler) return;
    this.notificationHandler = (notification) => {
      if (notification.method !== "v4/conversation/frame") return;
      this.handleFrame(notification.params);
    };
    client.on("notification", this.notificationHandler);
  }

  private workspaceRef(): { workspacePath: string; workspaceKey: string } {
    // 本地 MVP：identity key = workspacePath（与仓库 Workspace Identity 规则一致）。
    return { workspacePath: this.workspacePath, workspaceKey: this.workspacePath };
  }

  private async subscribe(client: ProtocolClient, sessionId: string): Promise<void> {
    const result = (await client.request("v4/conversation/subscribe", {
      topic: `conversation/${sessionId}`,
      connectionId: this.connectionId,
      clientMode: "desktop-continuous",
      workspace: this.workspaceRef(),
      visibility: "foreground",
    })) as { ack?: { subscriptionId?: string } };
    this.subscriptionId = result?.ack?.subscriptionId ?? null;
  }

  private async unsubscribe(): Promise<void> {
    if (!this.sessionId || !this.subscriptionId) {
      this.subscriptionId = null;
      return;
    }
    try {
      const client = await this.getClient();
      await client.request("v4/conversation/unsubscribe", {
        subscriptionId: this.subscriptionId,
      });
    } catch {
      // best-effort on session reset
    }
    this.subscriptionId = null;
  }

  private handleFrame(params: unknown): void {
    const frame = params as {
      kind?: string;
      snapshot?: unknown;
      topic?: string;
    };
    const snapshot =
      frame?.kind === "snapshot"
        ? frame.snapshot
        : (frame as { snapshot?: unknown }).snapshot ?? frame;
    if (!snapshot || typeof snapshot !== "object") return;
    const sessionId =
      this.sessionId ??
      String((snapshot as { sessionId?: string }).sessionId ?? "");
    if (!sessionId) return;
    const view: SessionSnapshotView = {
      sessionId,
      phase: String((snapshot as { phase?: string }).phase ?? ""),
      rows: extractRows(snapshot),
    };
    this.lastView = view;
    for (const listener of this.frameListeners) listener(view);
  }

  private emitStatus(kind: "info" | "error", message: string): void {
    for (const listener of this.statusListeners) listener({ kind, message });
  }
}
