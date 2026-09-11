#!/usr/bin/env bash
# Regression checks for deployment validation and preservation of private state.
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/tests/common.sh"
[[ $# == 0 ]] || fail 'Usage: pi/test-setup.sh'
agent="$CONFIG_PI_HOME/agent"
commands="$HOME/.claude/commands"
for source in "$repo/claude/skills"/*; do
  diff -r "$source" "$HOME/.claude/skills/${source##*/}" >/dev/null || fail 'Bundled skill contents differ'
done
for source in "$repo/claude/commands"/*.md; do
  cmp -s "$source" "$commands/${source##*/}" || fail 'Bundled command missing'
done
printf '%s\n' 'Private command' > "$commands/bro.md"
printf '%s\n' 'Private skill' > "$HOME/.claude/skills/comment/SKILL.md"
rm "$HOME/.claude/skills/how/references/explorer-prompt.md"
rm "$commands/debug.md"
rm -rf "$HOME/.claude/skills/grafana-logs"
ln -s "$test_dir/absent-skill" "$HOME/.claude/skills/grafana-logs"
mkdir -p "$commands/nested"
odd_name=$'quoted "command"\nname.md'
printf '%s\n' 'Unusual filename fixture.' > "$commands/nested/$odd_name"
printf '%s\n' '{"fixture":"not a credential"}' > "$agent/auth.json"
cp "$agent/auth.json" "$test_dir/auth.expected"
mkdir -p "$agent/extensions/browser/.profile" "$agent/extensions/subagent"
printf '%s\n' 'private browser fixture' > "$agent/extensions/browser/.profile/state"
printf '%s\n' '{"custom":true}' > "$agent/web-search.json"
cp "$repo/pi/tests/legacy-subagent-config.json" "$agent/extensions/subagent/config.json"
cp "$repo/pi/tests/legacy-mascot.ts" "$agent/extensions/mascot.ts"
printf '%s\n' \
  'touch "$HOME/zshrc-executed"' \
  'export GOOGLE_SEARCH_API_KEY="fixture-key"' \
  "export GOOGLE_CSE_ID='fixture-id' # literal credential" > "$HOME/.zshrc"
"$repo/init.sh" --pi
[[ "$(< "$commands/bro.md")" == 'Private command' ]] || fail 'Existing Claude command overwritten'
[[ "$(< "$HOME/.claude/skills/comment/SKILL.md")" == 'Private skill' ]] || fail 'Existing Claude skill overwritten'
[[ ! -e "$HOME/.claude/skills/how/references/explorer-prompt.md" ]] || fail 'Existing skill directory merged'
[[ -L "$HOME/.claude/skills/grafana-logs" && ! -e "$test_dir/absent-skill" ]] || fail 'Existing skill symlink changed'
cmp -s "$repo/claude/commands/debug.md" "$commands/debug.md" || fail 'Missing command not restored'
cmp -s "$repo/pi/agent/extensions/claude-skills.ts" "$agent/extensions/claude-skills.ts" || fail 'Claude discovery extension not deployed'
search_auth="$agent/extensions/web-search/auth.json"
jq -e '.google_search_api_key == "fixture-key" and .google_cse_id == "fixture-id"' "$search_auth" >/dev/null || fail 'Search auth import failed'
[[ ! -e "$HOME/zshrc-executed" ]] || fail 'Executed .zshrc'
[[ "$(ls -l "$search_auth")" == -rw-------* ]] || fail 'Search auth permissions'
cp "$search_auth" "$test_dir/search-auth.expected"
printf '%s\n' 'export GOOGLE_SEARCH_API_KEY=$(touch "$HOME/expansion-executed")' 'export GOOGLE_CSE_ID=other-id' > "$HOME/.zshrc"
bash "$repo/pi/search-auth.sh" "$agent"
cmp -s "$search_auth" "$test_dir/search-auth.expected" || fail 'Existing search auth overwritten'
mkdir -p "$test_dir/auth-agent"
bash "$repo/pi/search-auth.sh" "$test_dir/auth-agent"
[[ ! -e "$HOME/expansion-executed" && ! -e "$test_dir/auth-agent/extensions/web-search/auth.json" ]] || fail 'Accepted shell expansion as credentials'
jq -e --arg path "$commands/nested/$odd_name" '.prompts | index($path) != null' \
  "$agent/settings.json" >/dev/null || fail 'Unusual command path changed'
cmp -s "$agent/auth.json" "$test_dir/auth.expected" || fail 'Private auth overwritten'
[[ "$(< "$agent/extensions/browser/.profile/state")" == 'private browser fixture' ]] || fail 'Browser profile overwritten'
[[ "$(< "$agent/web-search.json")" == '{"custom":true}' ]] || fail 'Custom legacy config removed'
[[ ! -e "$agent/extensions/subagent/config.json" ]] || fail 'Managed legacy config retained'
for extension in browser prompt-snippets web-fetch web-search; do
  [[ -f "$agent/extensions/$extension/index.ts" && -L "$agent/extensions/$extension/node_modules" ]] || fail "Missing $extension deployment"
done
for source in "$repo/pi/agent/extensions/prompt-snippets/snippets/"*.md; do
  cmp -s "$source" "$agent/extensions/prompt-snippets/snippets/${source##*/}" || fail 'Repository snippet not deployed'
done
jq -e 'has("subagents") | not' "$agent/settings.json" >/dev/null || fail 'Legacy subagent settings'
jq -e '.["observational-memory"].models | all(.[]; .provider == "openai-codex" and .id == "gpt-5.6-sol" and .thinking == "medium")' "$agent/settings.json" >/dev/null || fail 'Memory model drift'
jq -e '.["observational-memory"].enabled == true' "$agent/settings.json" >/dev/null || fail 'Memory default disabled'
jq -e '.["observational-memory"].compactAtContextTokens == 700000 and
  .["observational-memory"].compactAtContextTokensByModel == {"openai-codex/gpt-6-astra": 350000} and
  .["observational-memory"].tailTokens == 40000 and
  .compaction.enabled == true and .compaction.reserveTokens == 128000 and
  .compaction.keepRecentTokens == 40000' "$agent/settings.json" >/dev/null || fail 'Long-context compaction drift'
cmp -s "$repo/pi/agent/models.json" "$agent/models.json" || fail 'Model overrides not deployed'
jq -e '.theme == "jetbrains-dark"' "$agent/settings.json" >/dev/null || fail 'Theme default drift'
for theme in vim-darcula jetbrains-dark; do
  cmp -s "$repo/pi/agent/themes/$theme.json" "$agent/themes/$theme.json" || fail 'Theme not deployed'
  jq -e --arg name "$theme" --slurpfile base "$repo/pi/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/dark.json" '
    . as $theme |
    .name == $name and
    (($base[0].colors | keys) - (.colors | keys) | length == 0) and
    all(.colors[]; . as $color | ($theme.vars[$color] // $color) | test("^#[0-9A-Fa-f]{6}$"))
  ' "$agent/themes/$theme.json" >/dev/null || fail 'Theme colors invalid'
done
jq -e '. as $theme | [.colors.toolPendingBg, .colors.toolSuccessBg, .colors.toolErrorBg] |
  map(. as $color | $theme.vars[$color] // $color) | unique | . == ["#1E1F22"]' \
  "$agent/themes/jetbrains-dark.json" >/dev/null || fail 'Live tool panels must remain charcoal'
[[ ! -e "$agent/extensions/mascot.ts" ]] || fail 'Retired mascot retained'
printf '%s\n' '// User-customized extension' > "$agent/extensions/mascot.ts"
cp "$agent/extensions/mascot.ts" "$test_dir/mascot.expected"
"$repo/init.sh" --pi > "$test_dir/mascot-setup.log" 2>&1
cmp -s "$agent/extensions/mascot.ts" "$test_dir/mascot.expected" || fail 'Customized mascot removed'
grep -q 'Preserving customized .*mascot.ts' "$test_dir/mascot-setup.log" || fail 'Missing customized mascot warning'
rm "$agent/extensions/mascot.ts"
"$repo/init.sh" --pi > "$test_dir/mascot-setup.log" 2>&1
[[ ! -e "$agent/extensions/mascot.ts" ]] || fail 'Retired mascot redeployed'
jq -e '.vars.editor == "#2B2B2B" and .vars.text == "#A9B7C6" and
  .vars.orange == "#CC7832" and .vars.green == "#6A8759" and
  .colors.syntaxFunction == "#FFC66D" and .colors.syntaxNumber == "#6897BB"' \
  "$agent/themes/vim-darcula.json" >/dev/null || fail 'Vim palette drift'
jq -e '.providers["openai-codex"].modelOverrides["gpt-6-astra"].contextWindow == 872000 and
  .providers.anthropic.modelOverrides["claude-fable-5"].contextWindow == 1000000 and
  .providers.anthropic.modelOverrides["claude-fable-5-1"].contextWindow == 1000000' "$agent/models.json" >/dev/null || fail 'Long-context model drift'
PI_CODING_AGENT_DIR="$agent" node "$repo/pi/tests/memory-threshold-fixture.mjs"
cp "$agent/settings.json" "$test_dir/settings.expected"

expect_setup_failure() {
  if "$repo/init.sh" --pi > "$test_dir/setup.log" 2>&1; then
    fail "Setup unexpectedly accepted $1"
  fi
  cmp -s "$agent/settings.json" "$test_dir/settings.expected" || fail "$1 changed deployed settings"
  [[ -z "$(find "$agent" -name '.deploy.*' -print)" ]] || fail "$1 leaked staging files"
}
cp "$commands/nested/$odd_name" "$commands/$odd_name"
expect_setup_failure 'duplicate commands'
grep -q 'Duplicate Claude command /' "$test_dir/setup.log" || fail 'Missing duplicate diagnostic'
rm "$commands/$odd_name"
# Inject discovery failures without modifying repository resources.
real_find="$(command -v find)"
mkdir "$test_dir/bin"
printf '#!/usr/bin/env bash\nfor arg; do\n  if [[ "$arg" == "$PI_TEST_FAIL_DIR" ]]; then exit 42; fi\ndone\nexec "$PI_TEST_FIND" "$@"\n' > "$test_dir/bin/find"
chmod +x "$test_dir/bin/find"
export PI_TEST_FIND="$real_find" PATH="$test_dir/bin:$PATH"
export PI_TEST_FAIL_DIR="$commands"
expect_setup_failure 'command discovery failure'
export PI_TEST_FAIL_DIR="$repo/pi/agent"
expect_setup_failure 'resource discovery failure'
# A globally available Pi must not cause npm inspection, upgrade or downgrade.
unset PI_TEST_FAIL_DIR
printf '#!/usr/bin/env bash\nexit 0\n' > "$test_dir/bin/pi-cli"
chmod +x "$test_dir/bin/pi-cli"
ln -s pi-cli "$test_dir/bin/pi"
printf '#!/usr/bin/env bash\necho "Unexpected global npm call" >&2\nexit 99\n' > "$test_dir/bin/npm"
chmod +x "$test_dir/bin/pi" "$test_dir/bin/npm"
(unset CONFIG_PI_HOME; "$repo/init.sh" --pi)
jq -e '.packages | length > 0' "$HOME/.pi/agent/settings.json" >/dev/null || fail 'Standard global config missing'
source "$repo/pi/command-path.sh"
pi_is_launcher "$test_dir/bin/pi" || fail 'Plain pi launcher not installed'
[[ "$(pi_real_command "$test_dir/bin/pi")" == "$(cd "$test_dir/bin" && pwd -P)/pi-cli" ]] || fail 'Global CLI target changed'
printf '%s\n' 'PASS: deployment validation, private-state preservation, standard config and executable launcher installation.'
