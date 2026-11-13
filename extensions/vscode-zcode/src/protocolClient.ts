import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

/** ZCode Protocol wire message (stdio NDJSON, LF-framed). */
export type WireMessage =
  | { id: string | number; method: string; params?: unknown }
  | { method: string; params?: unknown }
  | { id: string | number; result: unknown }
  | { id: string | number; error: { code: number; message: string; data?: unknown } };

export type ProtocolNotification = { method: string; params?: unknown };

/** CLI → Host reverse request (must be answered or createSession hangs). */
export type ProtocolServerRequest = {
  id: string | number;
  method: string;
  params?: unknown;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ServerRequestHandler = (request: ProtocolServerRequest) => Promise<unknown> | unknown;

const STORAGE_NOTIFICATION = "startup/storageState";
const RUNTIME_PREFERENCES_METHOD = "session/requestRuntimePreferences";
const DEFAULT_TIMEOUT_MS = 180_000;

/** Desktop-local defaults for MVP Host (see zcodeSessionRuntimePreferencesResultSchema). */
export const DEFAULT_RUNTIME_PREFERENCES = {
  nativeSearchEnhancementsEnabled: true,
  toolSearchMode: "off" as const,
  memoryEnabled: false,
  askUserQuestionAutoResolutionEnabled: true,
  modelContextBudgetStrategy: "preflight-v1" as const,
  appControlEnabled: false,
  subagentRuntimeConfigEnabled: false,
};

/**
 * Thin stdio NDJSON client for zcode app-server.
 * Host-shaped: Extension Host owns the process; webview stays UI-only.
 */
export class ProtocolClient extends EventEmitter {
  private nextId = 1;
  private readonly pending = new Map<string, Pending>();
  private readonly decoder = new StringDecoder("utf8");
  private pendingChunks: string[] = [];
  private disposed = false;
  private storageReady: Promise<void>;
  private markStorageReady!: () => void;
  private storageFailed!: (error: Error) => void;
  private sawStorageNotification = false;
  private serverRequestHandler: ServerRequestHandler | null = null;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly options: { startupTimeoutMs: number },
  ) {
    super();
    this.storageReady = new Promise<void>((resolve, reject) => {
      this.markStorageReady = resolve;
      this.storageFailed = reject;
    });
    // 无 storage 通知的旧/精简入口：超时后放行首个 RPC，避免侧栏永久卡住。
    const startupTimer = setTimeout(() => {
      if (!this.sawStorageNotification) this.markStorageReady();
    }, Math.min(options.startupTimeoutMs, 8_000));
    startupTimer.unref?.();

    // 默认 Host：回答 runtime 物化偏好；其它反向 RPC 回 method-not-found，避免静默丢请求。
    this.serverRequestHandler = (request) => {
      if (request.method === RUNTIME_PREFERENCES_METHOD) {
        return DEFAULT_RUNTIME_PREFERENCES;
      }
      const error = new Error(`Method not found: ${request.method}`) as Error & {
        code?: number;
      };
      error.code = -32601;
      throw error;
    };

    child.stdout.on("data", (chunk: Buffer | string) => this.onStdout(chunk));
    child.stdout.once("end", () => this.flushStdout());
    child.once("exit", (code, signal) => {
      this.rejectAll(new Error(`app-server exited (code=${code}, signal=${signal})`));
      this.emit("close");
    });
    child.once("error", (error) => {
      this.rejectAll(error instanceof Error ? error : new Error(String(error)));
      this.emit("close");
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      this.emit("stderr", String(chunk));
    });
  }

  /** Override reverse-RPC handling (tests / richer Host). */
  setServerRequestHandler(handler: ServerRequestHandler | null): void {
    this.serverRequestHandler = handler;
  }

  respond(id: string | number, result: unknown): Promise<void> {
    return this.write({ id, result });
  }

  respondError(
    id: string | number,
    error: { code: number; message: string; data?: unknown },
  ): Promise<void> {
    return this.write({ id, error });
  }

  async waitUntilReady(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error("aborted");
    await this.storageReady;
  }

  request(method: string, params?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error("ProtocolClient disposed"));
    const id = this.nextId++;
    const key = String(id);
    const frame = { id, method, ...(params !== undefined ? { params } : {}) };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`ZCode request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(key, { resolve, reject, timer });
      void this.write(frame).catch((error) => {
        clearTimeout(timer);
        this.pending.delete(key);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rejectAll(new Error("ProtocolClient disposed"));
    try {
      this.child.stdin.end();
    } catch {
      // ignore
    }
    this.child.kill();
  }

  private onStdout(chunk: Buffer | string): void {
    const text = typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    this.consumeText(text);
  }

  private flushStdout(): void {
    const rest = this.decoder.end();
    if (rest) this.consumeText(rest);
    if (this.pendingChunks.length > 0) {
      this.handleLine(this.pendingChunks.join(""));
      this.pendingChunks = [];
    }
  }

  private consumeText(text: string): void {
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) !== 0x0a) continue;
      const piece = text.slice(start, i);
      start = i + 1;
      const line =
        this.pendingChunks.length > 0 ? `${this.pendingChunks.join("")}${piece}` : piece;
      this.pendingChunks = [];
      if (line.endsWith("\r")) this.handleLine(line.slice(0, -1));
      else this.handleLine(line);
    }
    if (start < text.length) this.pendingChunks.push(text.slice(start));
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let message: WireMessage;
    try {
      message = JSON.parse(line) as WireMessage;
    } catch {
      this.emit("stderr", `invalid NDJSON: ${line.slice(0, 200)}`);
      return;
    }

    if ("id" in message && "result" in message) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(String(message.id));
      pending.resolve(message.result);
      return;
    }

    if ("id" in message && "error" in message) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(String(message.id));
      pending.reject(
        new Error(message.error.message || `RPC error ${message.error.code}`),
      );
      return;
    }

    // CLI → Host reverse request: { id, method, params }
    if ("id" in message && "method" in message && !("result" in message) && !("error" in message)) {
      const request = message as ProtocolServerRequest;
      this.emit("request", request);
      void this.dispatchServerRequest(request);
      return;
    }

    if ("method" in message && !("id" in message)) {
      const notification = message as ProtocolNotification;
      if (notification.method === STORAGE_NOTIFICATION) {
        this.sawStorageNotification = true;
        const phase = (notification.params as { phase?: string } | undefined)?.phase;
        if (phase === "ready") this.markStorageReady();
        if (phase === "failed") {
          this.storageFailed(new Error("app-server storage startup failed"));
        }
      }
      this.emit("notification", notification);
    }
  }

  private async dispatchServerRequest(request: ProtocolServerRequest): Promise<void> {
    const handler = this.serverRequestHandler;
    if (!handler) {
      await this.respondError(request.id, {
        code: -32601,
        message: `Method not found: ${request.method}`,
      }).catch(() => undefined);
      return;
    }
    try {
      const result = await handler(request);
      await this.respond(request.id, result);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error && typeof error.code === "number"
          ? error.code
          : -32603;
      await this.respondError(request.id, {
        code,
        message: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
    }
  }

  private write(message: WireMessage): Promise<void> {
    if (this.disposed || !this.child.stdin.writable) {
      return Promise.reject(new Error("stdio closed"));
    }
    const frame = `${JSON.stringify(message)}\n`;
    return new Promise((resolve, reject) => {
      this.child.stdin.write(frame, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private rejectAll(error: Error): void {
    for (const [key, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(key);
    }
  }
}
