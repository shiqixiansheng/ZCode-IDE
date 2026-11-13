# VS Code TinyZhuIDE sidebar (MVP)

## Product definition

Install a TinyZhuIDE extension in VS Code (or a VS Code-compatible shell such as Antigravity). The extension owns a sidebar chat surface. Local `zcode app-server --stdio` is the executing agent. This repository supplies the agent runtime and ZCode Protocol V4. The existing desktop three-pane shell is out of scope and must not be reshaped for this feature. Mac desktop branding lives in `specs/tinyzhu-ide-product.md`.

## Product rules

- One Activity Bar / sidebar view named TinyZhuIDE. Users open it from VS Code; they do not need the desktop app.
- Workspace folder path is the agent cwd and the `workspacePath` on V4 commands. Local MVP sets `workspaceKey` to the same path (identity key = `workspaceIdentity?.trim() || workspacePath`). Multi-root MVP uses the first folder only.
- One `app-server --stdio` process per workspace folder key (`workspacePath`). Restart on folder change or process death.
- Conversation truth lives in the CLI projection (`ConversationSnapshot` via topic frames). The extension keeps only draft text and optimistic pending overlays.
- Write path is V4 `v4/command` only. MVP commands are `createSession` and `sendText`. Stop uses `stop` when the session is running.
- Delivery profile is desktop-continuous semantics (live subscribe). No mobile replayable path.
- Extension Host must answer CLI→Host reverse RPCs on the same stdio. MVP answers `session/requestRuntimePreferences` with local defaults (`nativeSearchEnhancementsEnabled: true`, memory/appControl off). Unhandled reverse requests return method-not-found (`-32601`) so create/resume cannot hang on a silent drop.
- Permission / tool prompts that require UI resolution must surface in the sidebar when the snapshot carries pending interactions. MVP may show a textual prompt and `resolveInteraction` for the first blocking kind only; remaining kinds can fail closed with a visible error.
- External Claude Code / Codex / Antigravity first-party agent tabs are not targets. Sharing the same window is enough; peer-tab registration is out of scope.
- Do not import `@zcode/ui` React shell into the extension. Protocol types may come from `@zcode/shared` or a thin copied client if packaging forbids workspace linking in the first cut.

## Ownership

| State | Owner |
| --- | --- |
| Agent process lifecycle | Extension host `AgentProcessManager` |
| Stdio NDJSON RPC + topic subscribe + reverse RPC answers | Extension host `ProtocolClient` |
| Session id binding for the open sidebar | Extension host `SidebarSessionController` |
| Draft text, scroll, optimistic send overlay | Webview (local only) |
| Transcript rows, phase, queue, interactions | CLI V4 projection |

```text
VS Code Webview
  │ postMessage (draft / send / stop / resolve)
  ▼
Extension Host (SidebarSessionController)
  │ v4/command + topic subscribe
  ▼
zcode app-server --stdio
  └─ CommandInbox + ConversationSnapshot publisher
```

## Acceptance scenarios

1. Open a folder in VS Code, open ZCode sidebar, send one message. A session is created, the user row and assistant stream appear from projection frames.
2. Kill the agent process. The sidebar shows a reconnect/error state. Sending again respawns `app-server` and continues or starts a fresh session with an explicit notice.
3. Change the active workspace folder. The previous process is disposed. The new folder gets its own process and empty session.
4. With no folder open, the sidebar explains that a folder is required and does not spawn an agent.

## Shell UX (Antigravity-shaped)

Mirror the Antigravity-for-VS-Code product shape, not its backend:

- Activity Bar icon opens the ZCode chat side panel (Antigravity uses `agy`; we use local `zcode app-server --stdio`).
- `Cmd/Ctrl+L` focuses the ZCode sidebar (toggle chat focus).
- `Cmd/Ctrl+Shift+L` starts a new conversation.
- First open of the panel starts (or reuses) the local agent process for the active folder.

Package location: `extensions/vscode-zcode/` (VS Code extension; not the desktop Electron shell).

## Non-goals (MVP)

- Full ZCode desktop feature parity (split panes, browser pane, plugin store, remote SSH host).
- Embedding Monaco or replacing the VS Code editor.
- Publishing to Marketplace (local `vsce` package / `F5` debug is enough).
- Antigravity-only APIs or workbench patches.
- Peer tabs next to Claude Code / Codex inside Antigravity's first-party agent chrome.
