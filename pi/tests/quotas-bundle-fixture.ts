import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import quotas from "../overrides/quotas.ts";

type Command = { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> };

export default function (pi: ExtensionAPI) {
  const commands = new Map<string, Command>();
  quotas({ registerCommand: (name, command) => commands.set(name, command) } as ExtensionAPI);
  pi.registerCommand("quota-bundle-fixture", {
    handler: async (_args, ctx) => {
      let calls = 0;
      let component: any;
      let loaded: () => void;
      let rendered = "";
      let closed = false;
      let inFlight = false;
      let release: (() => void) | undefined;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        const anthropic = url === "https://api.anthropic.com/api/oauth/usage";
        assert(anthropic || url === "https://chatgpt.com/backend-api/wham/usage", "Unexpected network destination");
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("Authorization"), anthropic ? "Bearer sk-ant-oat-fixture" : "Bearer codex-fixture");
        if (!anthropic) assert.equal(headers.get("ChatGPT-Account-Id"), "account-fixture");
        calls++;
        if (inFlight) await new Promise<void>(resolve => { release = resolve; });
        return Response.json(anthropic
          ? { five_hour: { utilization: 25, resets_at: "2030-01-02T00:00:00Z" } }
          : { rate_limit: { primary_window: { used_percent: 60, reset_at: 1893542400 } } });
      };
      const testContext = {
        ...ctx, mode: "tui",
        ui: {
          ...ctx.ui,
          custom: async (factory: any) => {
            closed = false;
            let ready = new Promise<void>(resolve => { loaded = resolve; });
            const tui = { requestRender() {
              queueMicrotask(() => {
                if (!component || closed) return;
                const lines = component.render(100);
                if (lines.some((line: string) => line.includes("Fetching quotas..."))) return;
                rendered = lines.join("\n");
                loaded();
              });
            } };
            component = factory(tui, { fg: (_color: string, text: string) => text, bold: (text: string) => text }, {}, () => { closed = true; });
            try {
              await ready;
              for (const width of [1, 20, 80]) assert(component.render(width).every((line: string) => visibleWidth(line) <= width));
              ready = new Promise<void>(resolve => { loaded = resolve; });
              component.handleInput("r");
              component.handleInput("r");
              await ready;
              component.handleInput("q");
              assert(closed);
              return null;
            } finally {
              component.dispose();
              component = undefined;
            }
          },
        },
      } as ExtensionCommandContext;
      try {
        assert.equal(commands.get("usage")!.handler, commands.get("quotas")!.handler);
        await commands.get("usage")!.handler("", testContext);
        assert(rendered.includes("Anthropic") && rendered.includes("OpenAI Codex"));
        assert(rendered.includes("75% left") && rendered.includes("40% left"));
        assert.equal(calls, 4, "Refresh must coalesce repeated keypresses");
        await commands.get("quotas")!.handler("", testContext);
        assert.equal(calls, 6, "Alias reuses cache before explicit refresh");
        for (const mode of ["print", "json", "rpc"]) {
          await commands.get("usage")!.handler("", { ...testContext, mode } as ExtensionCommandContext);
        }
        assert.equal(calls, 6);

        // Close a provider dashboard while a forced refresh is still pending.
        inFlight = true;
        let requestRenderCount = 0;
        testContext.ui.custom = async (factory: any) => {
          const component = factory({ requestRender: () => requestRenderCount++ }, { fg: (_c: string, text: string) => text, bold: (text: string) => text }, {}, () => {});
          await new Promise(resolve => setImmediate(resolve));
          component.handleInput("r");
          await new Promise(resolve => setImmediate(resolve));
          assert(release, "Refresh did not reach fetch");
          component.handleInput("\u001b");
          component.dispose();
          const before = requestRenderCount;
          release!();
          await new Promise(resolve => setImmediate(resolve));
          assert.equal(requestRenderCount, before, "Closed dashboard rendered a late response");
          return null;
        };
        await commands.get("anthropic:quotas")!.handler("", testContext);
        console.log("PASS: bundled CLI quotas aliases, both providers, refresh coalescing, close during fetch and headless guards");
      } finally { globalThis.fetch = originalFetch; }
    },
  });
}
