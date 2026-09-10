import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { openQuotaView } from "../node_modules/@latentminds/pi-quotas/src/extensions/command-quotas/command.ts";
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
      await openQuotaView(
        title,
        async (force, signal) => Promise.all(providers.map(async (provider) => ({
          provider,
          result: await fetchProviderQuotas(quotaAuthStorage(ctx.modelRegistry), provider, { force, signal }),
        }))),
        ctx,
      );
    },
  });
  const combined = dashboard(["anthropic", "openai-codex"], "Subscription quotas");
  pi.registerCommand("usage", combined);
  pi.registerCommand("quotas", combined);
  pi.registerCommand("anthropic:quotas", dashboard(["anthropic"], "Anthropic quotas"));
  pi.registerCommand("codex:quotas", dashboard(["openai-codex"], "Codex quotas"));
}
