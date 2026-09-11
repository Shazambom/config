import { VERSION, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

export default function (pi: ExtensionAPI) {
  let dispose: (() => void) | undefined;

  function show(ctx: ExtensionContext) {
    dispose?.();
    dispose = undefined;
    if (ctx.mode !== "tui" || process.env.PI_SUBAGENT_AGENT || process.env.OM_WORKER) return;

    ctx.ui.setHeader((tui, theme) => {
      let frame = 0;
      let stopped = false;
      let timer: ReturnType<typeof setInterval> | undefined;
      let unsubscribe: (() => void) | undefined;
      const stop = () => {
        if (timer) clearInterval(timer);
        timer = undefined;
        unsubscribe?.();
        unsubscribe = undefined;
      };
      dispose = stop;
      timer = setInterval(() => {
        frame++;
        tui.requestRender();
      }, 100);
      timer.unref();
      unsubscribe = ctx.ui.onTerminalInput(() => {
        stopped = true;
        stop();
        tui.requestRender();
        return undefined;
      });

      return {
        render(width: number): string[] {
          const blink = !stopped && frame >= 40 && frame % 40 < 2;
          const eye = blink
            ? theme.fg("text", "\u2501".repeat(2))
            : theme.fg("text", "\u2588") + theme.fg("dim", "\u258C");
          const blue = (text: string) => theme.fg("accent", text);
          const leg = `     ${blue("\u2588".repeat(2))}    ${blue("\u2588".repeat(2))}`;
          const art = [
            `     ${eye}    ${eye}`,
            `  ${blue("\u2588".repeat(14))}`,
            leg, leg, leg, leg,
          ];
          const visible = stopped ? art.length : Math.min(art.length, Math.floor(frame / 2) + 1);
          return [
            "",
            ...art.map((line, index) => index < visible ? line : ""),
            theme.fg("muted", `  pi ${VERSION} · /help · /mascot off`),
            "",
          ].map(line => truncateToWidth(line, Math.max(0, width), ""));
        },
        invalidate() {},
        dispose: stop,
      };
    });
  }

  pi.on("session_start", (_event, ctx) => show(ctx));
  pi.on("session_shutdown", () => {
    dispose?.();
    dispose = undefined;
  });
  pi.registerCommand("mascot", {
    description: "Replay the Pi mascot, or use /mascot off for the standard header",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui" || process.env.PI_SUBAGENT_AGENT || process.env.OM_WORKER) return;
      if (args.trim() === "off") {
        dispose?.();
        dispose = undefined;
        ctx.ui.setHeader(undefined);
      } else {
        show(ctx);
      }
    },
  });
}
