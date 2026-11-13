import {
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@zcode/shared/test-ids";
import { clearAppData, clickTestIdByDom } from "#e2e/helpers/desktop-app";
import { prepareV4ConversationE2E } from "#e2e/helpers/v4-conversation";

/**
 * IDE 列拓扑：设置切到 ide 后壳层 data 属性与文件树顶栏回退入口可见。
 * 不发送模型请求。
 */
describe("工作区 IDE 布局", () => {
  before(async () => {
    await prepareV4ConversationE2E({ skipProvider: true });
    await setLayoutMode("agent-primary");
  });

  after(async () => {
    await setLayoutMode("agent-primary");
    await clearAppData();
  });

  it("IDE-01 切换为 IDE 布局后出现三栏壳与回退入口", async () => {
    await setLayoutModeViaSettings("ide");
    await waitForLayout("ide");
    await $('[data-workspace-shell-layout="ide"]').waitForDisplayed();
    await $('[data-testid="workspace-ide-explorer"]').waitForDisplayed();
    await $('[data-testid="workspace-ide-preview"]').waitForDisplayed();
    await $('[data-testid="workspace-ide-exit-layout"]').waitForDisplayed();
    await $('[data-testid="workspace-ide-open-settings"]').waitForDisplayed();

    await clickTestIdByDom("workspace-ide-exit-layout");
    await waitForLayout("agent-primary");
    await $('[data-workspace-shell-layout="agent-primary"]').waitForDisplayed();
    expect(await $('[data-testid="workspace-ide-explorer"]').isExisting()).toBe(false);
  });
});

async function setLayoutMode(mode: "agent-primary" | "ide") {
  await browser.execute((next) => {
    localStorage.setItem("zcode-workspace-shell-layout-mode", next);
  }, mode);
  await browser.refresh();
  await waitForLayout(mode);
}

async function setLayoutModeViaSettings(mode: "agent-primary" | "ide") {
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON);
  await $(`[data-testid="${TID_SETTINGS_PAGE}"]`).waitForDisplayed();
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "general"));
  const select = '[role="combobox"][aria-label="工作区布局"]';
  await $(select).waitForDisplayed();
  await $(select).click();
  const optionLabel = mode === "ide" ? "IDE 布局" : "Agent 居中";
  await browser.waitUntil(
    async () =>
      browser.execute((label) => {
        const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
          (item) => item.textContent?.trim() === label,
        );
        if (!option) return false;
        option.click();
        return true;
      }, optionLabel),
    { timeout: 10000, timeoutMsg: `未找到布局选项 ${optionLabel}` },
  );
  await waitForLayout(mode);
  await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON);
}

async function waitForLayout(mode: "agent-primary" | "ide") {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (expected) => localStorage.getItem("zcode-workspace-shell-layout-mode") === expected,
        mode,
      ),
    { timeout: 15000, timeoutMsg: `布局未变为 ${mode}` },
  );
}
