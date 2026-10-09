# Subagent model discovery

`subagents_list` advertised one example model per provider, preferring the parent's
current model, but labeled the output as available models. With Astra active on
OpenAI Codex, this hid Sol even though explicit Sol IDs passed launch preflight.
Provider diversity and model diversity are different; do not deduplicate model
choices by provider or silently cap discovery at twelve providers.

`pi/patches/interactive-subagents.patch` owns `modelOptions()`. List every model
from `ctx.modelRegistry.getAvailable()`, grouped by provider with full IDs. Keep
credential-presence caveats: this inventory does not establish token validity,
subscription entitlement for each model, quota, connectivity, or child sandbox
access. Do not change launch defaults or copy credentials to fix discovery.

`bash pi/test-subagent-provider.sh` exercises the registered `subagents_list` tool
with the real SDK registry and synthetic credentials. It checks all same-provider
choices, excluded unauthenticated providers, no credentials in output, empty
availability, and more than twelve providers, alongside existing preflight tests.
Deployment uses `init.sh --pi-no-terminal`; existing sessions need `/reload` to
replace the extension runtime. Verify installed discovery separately from live
inference: a catalogue listing is not proof that the provider accepted a request.

The fix passed the discovery fixture against both a freshly applied patch and the
installed extension, plus `pi/test-team.sh` (including actual CLI arena paths with
a fake provider). An explicit `openai-codex/gpt-6-sol` reviewer completed; parent
inspection of its saved assistant messages confirmed that provider/model and a
normal final stop. This verifies that specific Sol route, not every listed model.
