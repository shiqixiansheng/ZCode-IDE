/**
 * Local/mac unsigned packaging fallback.
 * Deep ad-hoc codesign so Gatekeeper App Translocation does not leave a Dock
 * zombie stuck in dyld before Electron main runs. Not a Developer ID or
 * notarization substitute.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "../../../scripts/spawn-command.mjs";

export function resolvePackedMacAppPath(appOutDir) {
  if (!appOutDir || !existsSync(appOutDir)) {
    return null;
  }
  const apps = readdirSync(appOutDir).filter((name) => name.endsWith(".app"));
  if (apps.length !== 1) {
    return null;
  }
  return join(appOutDir, apps[0]);
}

export function applyDeepAdhocCodesign(appPath, options = {}) {
  const run = options.runCommand ?? runCommand;
  if (!appPath || !existsSync(appPath)) {
    throw new Error(`macOS ad-hoc codesign target missing: ${appPath ?? "<empty>"}`);
  }
  run("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
  return appPath;
}

export function applyDeepAdhocCodesignIfNeeded(context, options = {}) {
  const enabled = options.enabled ?? true;
  if (!enabled) {
    return { applied: false, reason: "disabled" };
  }
  if (context?.electronPlatformName !== "darwin") {
    return { applied: false, reason: "not-darwin" };
  }
  const appPath = resolvePackedMacAppPath(context.appOutDir);
  if (!appPath) {
    throw new Error(
      `[afterPack] expected exactly one .app under ${context.appOutDir} for ad-hoc codesign`,
    );
  }
  applyDeepAdhocCodesign(appPath, options);
  return { applied: true, appPath };
}
