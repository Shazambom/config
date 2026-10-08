import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, matchesKey } from "@earendil-works/pi-tui";

export default function (pi: ExtensionAPI) {
  let unsubscribe: (() => void) | undefined;
  pi.on("session_start", (_event, ctx) => {
    unsubscribe?.();
    if (ctx.mode !== "tui") return;
    let ui: any;
    ctx.ui.setWidget("vim-scroll", tui => {
      ui = tui;
      return { render: () => [], invalidate() {} };
    });
    unsubscribe = ctx.ui.onTerminalInput(data => {
      if (!matchesKey(data, "shift+g") || isKeyRelease(data) ||
          ui?.mode !== "fullscreen" || ui.hasOverlay()) return;
      const editor = ui.getFocusedComponent();
      if (editor?.getVimMode?.() !== "normal" || editor.isVimInputPending?.()) return;
      ui.scrollToBottom();
      return { consume: true };
    });
  });
  pi.on("session_shutdown", () => { unsubscribe?.(); unsubscribe = undefined; });
}
