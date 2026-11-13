import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { ProtocolClient } from "./protocolClient";

export type WorkspaceAgentBinding = {
  workspacePath: string;
  client: ProtocolClient;
  child: ChildProcessWithoutNullStreams;
};

function findUpward(startDir: string, relativePath: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 12; i += 1) {
    const candidate = join(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Resolve zcode.cjs the way desktop Host does: env override → setting → walk up to
 * apps/zcode-cli/packages/cli/dist/zcode.cjs.
 */
export function resolveAgentEntry(options: {
  configuredEntry?: string;
  searchFrom: string;
}): string {
  const fromEnv = process.env.ZCODE_AGENT_ENTRY?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const configured = options.configuredEntry?.trim();
  if (configured && existsSync(configured)) return configured;
  const fromTree = findUpward(options.searchFrom, "apps/zcode-cli/packages/cli/dist/zcode.cjs");
  if (fromTree) return fromTree;
  throw new Error(
    "找不到 zcode.cjs。请先构建 apps/zcode-cli，或设置 zcode.agentEntry / ZCODE_AGENT_ENTRY。",
  );
}

/** One app-server --stdio per workspace folder (Antigravity local `agy` analogue). */
export class AgentProcessManager {
  private readonly byWorkspace = new Map<string, WorkspaceAgentBinding>();

  constructor(private readonly startupTimeoutMs: number) {}

  async getClient(workspacePath: string, entryPath: string): Promise<ProtocolClient> {
    const existing = this.byWorkspace.get(workspacePath);
    if (existing) return existing.client;

    const child = spawn(process.execPath, [entryPath, "app-server", "--stdio"], {
      cwd: workspacePath,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    const client = new ProtocolClient(child, { startupTimeoutMs: this.startupTimeoutMs });
    const binding: WorkspaceAgentBinding = { workspacePath, client, child };
    this.byWorkspace.set(workspacePath, binding);

    const clear = () => {
      if (this.byWorkspace.get(workspacePath) === binding) {
        this.byWorkspace.delete(workspacePath);
      }
    };
    client.on("close", clear);
    child.once("exit", clear);

    await client.waitUntilReady();
    return client;
  }

  disposeWorkspace(workspacePath: string): void {
    const binding = this.byWorkspace.get(workspacePath);
    if (!binding) return;
    this.byWorkspace.delete(workspacePath);
    binding.client.dispose();
  }

  disposeAll(): void {
    for (const path of [...this.byWorkspace.keys()]) this.disposeWorkspace(path);
  }
}
