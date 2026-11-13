# TinyZhuIDE product (Mac ship)

## Product definition

Ship the desktop app and VS Code sidebar under the product name **TinyZhuIDE**. Local agent execution remains `zcode app-server --stdio`. Users get a Mac `.app` / `.dmg` they can install next to (or instead of) the old ZCode branding.

## Product rules

- Visible product name is `TinyZhuIDE` in the Mac dock, About panel, DMG artifact, Activity Bar title, and sidebar chrome.
- Production identity uses `appId` `app.tinyzhu.ide` so TinyZhuIDE can install beside an older `dev.zcode.app` ZCode build.
- Preview identity uses `app.tinyzhu.ide.preview` / `TinyZhuIDE Preview`.
- Linux executable / package names follow `tinyzhu-ide` / `tinyzhu-ide-preview` for consistency with the new brand.
- Agent protocol, workspace packages (`@zcode/*`), and CLI binary names stay on the existing zcode technical identifiers unless a later PR migrates them.
- Sidebar chat UI follows Antigravity agent-panel cues: compact header with brand tab, quiet session strip, transcript bubbles, bottom composer with Agent mode chip and Send/Stop. Do not reshape the desktop three-pane shell in this ship.

## Ownership

| State | Owner |
| --- | --- |
| Mac / Windows / Linux install identity | `packages/desktop/scripts/desktop-product-identity.mjs` |
| electron-builder `appId` / `productName` | `packages/desktop/electron-builder.config.js` (reads identity) |
| VS Code sidebar chrome + copy | `extensions/vscode-zcode` |
| Agent process + V4 session | unchanged from `specs/vscode-zcode-sidebar.md` |

## Acceptance scenarios

1. `ZCODE_ENV=production` resolves productName `TinyZhuIDE` and appId `app.tinyzhu.ide`.
2. Mac arm64 pack produces `TinyZhuIDE-*-mac-arm64.dmg` (or matching artifact name) and an app bundle whose dock name is TinyZhuIDE.
3. Installing the app to `/Applications/TinyZhuIDE.app` launches without conflicting with an existing ZCode.app.
4. Extension / sidebar shows TinyZhuIDE branding and Antigravity-like composer layout.
5. Packaged About / tray / window title use TinyZhuIDE (not leftover ZCode chrome strings).
6. CUA Helper Team allowlist still names `dev.zcode.app` only; TinyZhuIDE Computer Use needs a follow-up allowlist PR if CUA is required on this SKU.
