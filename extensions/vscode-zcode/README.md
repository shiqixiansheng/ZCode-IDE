# TinyZhuIDE for VS Code

Antigravity-shaped chat sidebar branded **TinyZhuIDE** that runs **local zcode** (`app-server --stdio`) instead of `agy` / Claude Code / Codex.

## Product shape

| Antigravity (VS Code extension) | This extension |
| --- | --- |
| Activity Bar → chat side panel | Activity Bar **ZCode** → Chat webview |
| Local `agy` backend | Local `zcode app-server --stdio` |
| Cmd/Ctrl+L focus chat | `zcode.toggleChatFocus` |
| Cmd/Ctrl+Shift+L new conversation | `zcode.startNewConversation` |

Spec: [`specs/vscode-zcode-sidebar.md`](../../specs/vscode-zcode-sidebar.md).

## Prerequisites

1. Node 24 (see repo `mise.toml`).
2. Build the agent entry once from the monorepo root:

```bash
pnpm bootstrap
# or at least build the CLI package that produces:
# apps/zcode-cli/packages/cli/dist/zcode.cjs
```

3. Open a **folder** workspace in VS Code (multi-root MVP uses the first folder).

## Debug / run

```bash
cd extensions/vscode-zcode
npm install
npm run compile
```

Then in VS Code:

1. Open this monorepo (or the `extensions/vscode-zcode` folder).
2. Run **Debug: Extension** via `.vscode/launch.json` in this package, or Command Palette → “Debug: Start Debugging” with the “Run ZCode Extension” config.
3. In the Extension Development Host, open a workspace folder and click the ZCode Activity Bar icon.

Optional settings:

- `zcode.agentEntry`: absolute path to `zcode.cjs`
- env `ZCODE_AGENT_ENTRY`: same override

## Architecture

```text
Webview (draft / send UI)
  → Extension Host SidebarSessionController
  → ProtocolClient (NDJSON stdio)
  → zcode app-server --stdio
```

Conversation rows come from `v4/conversation/frame` projection. The webview does not own accepted transcript.

## Non-goals (MVP)

Desktop UI parity, Marketplace publish, Antigravity first-party agent tab registration, Monaco embedding.
