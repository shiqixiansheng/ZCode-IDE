# Cursor IDE 布局模式（shell）

## 目标与范围

把桌面工作区壳层从「Agent 居中」切到 Cursor 式三栏：`文件树 | 预览/代码 | Agent 对话`。本阶段只改变 **列拓扑与打开文件落点**，不改变会话协议、Host/CLI 归属、模型、工具权限或历史数据。

不在本次范围：Monaco 可编辑中心编辑器、VS Code 扩展旁路、手机 Web 壳重排、把任务列表做成 Cursor 资源管理器的完整替代。

## 与「通用 / 编程模式」的关系

`interfaceMode`（`office` / `coding`，见 [general-coding-mode.md](./general-coding-mode.md)）继续只控制 **开发信息密度与入口可见性**。

新增正交偏好：

| 字段                       | 取值              | 含义                                         |
| -------------------------- | ----------------- | -------------------------------------------- |
| `workspaceShellLayoutMode` | `ide`（桌面默认） | Cursor 式：左文件树 \| 中预览/代码 \| 右对话 |
| `workspaceShellLayoutMode` | `agent-primary`   | 左任务栏 \| 中对话 \| 右工具侧栏             |

桌面在 localStorage 键 `zcode-workspace-shell-layout-mode` **未设置**时默认 `ide`（常量 `DEFAULT_WORKSPACE_SHELL_LAYOUT_MODE`）。用户显式选择的 `agent-primary` 仍有效。显式非法值仍按 `normalizeWorkspaceShellLayoutMode` 落到 `agent-primary`，不把垃圾值改写成 `ide`。

二者独立。IDE 布局在 `office` 下仍可用，但侧栏开发入口仍受 `interfaceMode` 过滤。

## 产品行为（`ide`）

| 区域 | 内容                                        | 说明                                                                |
| ---- | ------------------------------------------- | ------------------------------------------------------------------- |
| 左栏 | `WorkspaceFileTree`（工作区文件树）         | 复用现有 tree；任务/项目导航收入窄轨或折叠，不复制 session 状态     |
| 中栏 | 当前文件预览 / code-viewer（`PreviewPane`） | 从右侧 side pane 提升为 primary；无打开文件时显示空状态             |
| 右栏 | `V4ChatPane`                                | 现有 Agent 对话；默认可调窄宽，持久化宽度                           |
| 底栏 | 终端（可选）                                | 仍挂在对话列或壳层底部既有 `AnimatedTerminalPanel` 路径，不新造 PTY |

打开文件：树点击 / 「查看文件」在 `ide` 下落到 **中栏**，不默认再开右侧 `file-manager` / `code-viewer` 标签（已打开的侧栏标签不强制关闭）。

切回 `agent-primary`：恢复现有列拓扑；中栏打开的预览可迁回 side pane 或关闭（实现选更短路径，验收只要求拓扑正确）。

## 状态所有者

```text
设置 / 命令 / 快捷键
  -> ZCodeStore.setWorkspaceShellLayoutMode
      -> localStorage: zcode-workspace-shell-layout-mode
      -> state 广播（抑制回声，同 interfaceMode）
      -> WorkspaceShellLayout 列装配
      -> useAppPanels 打开落点分支

会话 / CommandInbox / Host          -> 不参与
paneLayoutStore（对话 split）       -> 仅 agent-primary 中心对话分屏；ide 右栏暂不引入多对话 split
```

- 身份 key 仍为 `workspaceIdentity?.trim() || workspacePath`。
- Desktop continuous 与手机 `web-remote-replayable` 不因本模式新增恢复语义；手机可继续只用 `agent-primary`，或后续单独验收。

## 验收场景

1. 桌面清数据 / 首次打开本地 workspace（键未设置）：壳层即为 `ide`，三栏为树 \| 预览空态 \| 对话，无需先改设置。
2. 树中打开文本文件：中栏出现预览，右栏对话仍在。
3. 切回 `agent-primary`：中心恢复对话，文件树不再占据左栏主位。
4. 模式切换不丢当前 sessionId，不重启 app-server。

E2E：`packages/desktop/test/e2e/ui-shell/navigation/workspace-ide-layout.test.ts` 覆盖新鲜存储默认 `ide`，以及设置切换 / 退出路径。
