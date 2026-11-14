import { describe, expect, it, vi } from "vitest";
import {
  applyDeepAdhocCodesignIfNeeded,
  resolvePackedMacAppPath,
} from "../scripts/macos-adhoc-codesign.mjs";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("macos ad-hoc codesign packaging fallback", () => {
  it("resolves the single packed .app under appOutDir", () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-adhoc-"));
    try {
      mkdirSync(join(root, "Tiny Zcode IDE.app"));
      expect(resolvePackedMacAppPath(root)).toBe(join(root, "Tiny Zcode IDE.app"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs deep ad-hoc codesign on darwin when enabled", () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-adhoc-"));
    const appPath = join(root, "Tiny Zcode IDE.app");
    mkdirSync(appPath);
    writeFileSync(join(appPath, "Contents"), "");
    const runCommand = vi.fn();
    try {
      const result = applyDeepAdhocCodesignIfNeeded(
        { electronPlatformName: "darwin", appOutDir: root },
        { enabled: true, runCommand },
      );
      expect(result).toEqual({ applied: true, appPath });
      expect(runCommand).toHaveBeenCalledWith(
        "codesign",
        ["--force", "--deep", "--sign", "-", appPath],
        { stdio: "inherit" },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips when Developer ID signing path disables the fallback", () => {
    const result = applyDeepAdhocCodesignIfNeeded(
      { electronPlatformName: "darwin", appOutDir: "/tmp" },
      { enabled: false, runCommand: vi.fn() },
    );
    expect(result).toEqual({ applied: false, reason: "disabled" });
  });
});
