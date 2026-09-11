import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const writes: { time: number; data: string }[] = [];
  const started = Date.now();
  const original = process.stdout.write;
  process.stdout.write = function (chunk: any, ...args: any[]) {
    writes.push({ time: Date.now() - started, data: String(chunk) });
    return original.call(this, chunk, ...args);
  } as typeof original;
  let timer: ReturnType<typeof setTimeout> | undefined;
  pi.on("session_shutdown", () => {
    clearTimeout(timer);
    writeFileSync(process.env.PI_STARTUP_RESULT! + '.' + started, JSON.stringify(writes));
    process.stdout.write = original;
  });
  pi.on("session_start", (event, ctx) => {
    const historyLines = Math.min(2000, Math.max(0, Number(process.env.PI_STARTUP_HISTORY_LINES ?? 0)));
    if (event.reason === "startup" && historyLines > 0) {
      pi.sendMessage({ customType: "startup-fixture", content: Array.from({ length: historyLines }, (_, index) => `Synthetic transcript row ${index}`).join("\n"), display: true });
    }
    timer = setTimeout(() => {
      ctx.shutdown();
    }, 5200);
    timer.unref();
  });
}
