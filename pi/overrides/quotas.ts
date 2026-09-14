import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { QuotasComponent } from "../node_modules/@latentminds/pi-quotas/src/extensions/command-quotas/components/quotas-display.ts";
import { quotaAuthStorage } from "../node_modules/@latentminds/pi-quotas/src/lib/auth.ts";
import { fetchProviderQuotas } from "../node_modules/@latentminds/pi-quotas/src/lib/quotas.ts";

type Provider = "anthropic" | "openai-codex";

export default function (pi: ExtensionAPI) {
  const dashboard = (providers: Provider[], title: string) => ({
    description: `Show ${title.toLowerCase()}`,
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (ctx.mode !== "tui" || process.env.PI_SUBAGENT_AGENT || process.env.OM_WORKER) {
        ctx.ui.notify("Quota dashboards are available only in the main interactive Pi session.", "info");
        return;
      }
      await ctx.ui.custom<null>((tui, theme, _keys, done) => {
        const controller = new AbortController();
        let loading = false;
        const component = new QuotasComponent(theme, tui, title, () => {
          controller.abort();
          done(null);
        }, () => { void load(true); });

        async function load(force = false): Promise<void> {
          if (loading || controller.signal.aborted) return;
          loading = true;
          if (force) component.setState({ type: "loading" });
          tui.requestRender();
          try {
            const snapshots = await Promise.all(providers.map(async (provider) => ({
              provider,
              result: await fetchProviderQuotas(quotaAuthStorage(ctx.modelRegistry), provider, {
                force, signal: controller.signal,
              }),
            })));
            if (!controller.signal.aborted) component.setState({ type: "loaded", snapshots });
          } catch {
            if (!controller.signal.aborted) component.setState({
              type: "loaded",
              snapshots: providers.map(provider => ({
                provider,
                result: { success: false, error: { kind: "network", message: "Quota lookup failed" } },
              })),
            });
          } finally {
            loading = false;
            if (!controller.signal.aborted) tui.requestRender();
          }
        }

        void load();
        return {
          render: (width: number) => component.render(width),
          invalidate: () => component.invalidate(),
          handleInput: (data: string) => component.handleInput(data),
          dispose: () => {
            controller.abort();
            component.destroy();
          },
        };
      });
    },
  });
  const combined = dashboard(["anthropic", "openai-codex"], "Subscription quotas");
  pi.registerCommand("usage", combined);
  pi.registerCommand("quotas", combined);
  pi.registerCommand("anthropic:quotas", dashboard(["anthropic"], "Anthropic quotas"));
  pi.registerCommand("codex:quotas", dashboard(["openai-codex"], "Codex quotas"));
}
