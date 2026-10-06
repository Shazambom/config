import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, matchesKey, type TUI, type TuiAltScreen } from "@earendil-works/pi-tui";

type SelectionUI = TUI & Partial<Pick<TuiAltScreen, "hasActiveSelection" | "copyActiveSelectionToClipboard">>;

export default function (pi: ExtensionAPI) {
  let unsubscribe: (() => void) | undefined;
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    let ui: SelectionUI | undefined;
    // A zero-row widget supplies Pi's stable renderer reference without replacing the editor.
    ctx.ui.setWidget("selection-copy", (tui) => {
      ui = tui;
      return { render: () => [], invalidate() {} };
    }, { placement: "belowEditor" });
    unsubscribe = ctx.ui.onTerminalInput((data) => {
      if (!matchesKey(data, "ctrl+c") || isKeyRelease(data) || ui?.mode !== "fullscreen" ||
          ui.hasOverlay() || !ui.hasActiveSelection?.() || !ui.copyActiveSelectionToClipboard) return;
      void ui.copyActiveSelectionToClipboard().catch(() => ctx.ui.notify("Unable to copy selected text", "error"));
      return { consume: true };
    });
  });
  pi.on("session_shutdown", () => {
    unsubscribe?.();
    unsubscribe = undefined;
  });
}
