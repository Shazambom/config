#!/usr/bin/env bash
# Invoked only through init.sh --pi, after pinned Node/npm/jq bootstrap.
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
bash "$repo/claude/setup.sh"
# Reinstall only when the lockfile changes or the executable is missing.
if [[ ! -x "$repo/pi/node_modules/.bin/pi" ]] || ! cmp -s "$repo/pi/package-lock.json" "$repo/pi/node_modules/.portable-lock.json"; then
  npm ci --prefix "$repo/pi" --ignore-scripts --no-audit --no-fund >&2
  cp "$repo/pi/package-lock.json" "$repo/pi/node_modules/.portable-lock.json"
fi
bash "$repo/pi/upstream.sh"
bash "$repo/pi/system-tools.sh"
# Bootstrap global Pi only when absent; existing installs update independently.
if [[ -n "${CONFIG_PI_GLOBAL_PREFIX:-}" && "${CONFIG_PI_INSTALL_GLOBAL:-0}" == 1 ]]; then
  npm install --global --prefix "$CONFIG_PI_GLOBAL_PREFIX" --no-audit --no-fund \
    '@earendil-works/pi-coding-agent@latest' >&2
fi
agent="${CONFIG_PI_HOME:-$HOME/.pi}/agent"
mkdir -p "$agent"
chmod 700 "$agent"
stage="$(mktemp -d "$agent/.deploy.XXXXXX")"
cleanup() { rm -rf -- "$stage"; }
trap cleanup EXIT

# Exact NUL-delimited paths preserve unusual filenames. Capture find failures
# before deployment; process substitution would hide its exit status.
: > "$stage/commands"
if [[ -d "$HOME/.claude/commands" ]]; then
  find -L "$HOME/.claude/commands" -type f -name '*.md' -print0 > "$stage/commands"
fi
find "$repo/pi/agent" -type f ! -path "$repo/pi/agent/settings.json" -print0 > "$stage/resources"

# jq validates flattened command names and generates JSON; Bash owns file IO.
jq --arg root "$repo/pi" --slurpfile upstream "$repo/pi/upstream.json" --rawfile commands "$stage/commands" '
  def package_path:
    if startswith("../upstream/") then
      ltrimstr("../upstream/") as $name |
      ($upstream[0][] | select(.name == $name)) as $pin |
      $root + "/upstream/" + $name + "-" + $pin.ref
    else $root + ltrimstr("..") end;
  ($commands | split("\u0000") | map(select(length > 0))) as $files |
  ($files | map({path: ., name: (split("/")[-1] | rtrimstr(".md"))}) |
    group_by(.name) | map(select(length > 1))) as $duplicates |
  if ($duplicates | length) > 0 then
    $duplicates[0] | error("Duplicate Claude command /\(.[0].name): \(map(.path) | join(" and ")). Rename one to avoid shadowing.")
  else
    .prompts = ((.prompts // []) + $files) |
    .packages |= map(if type == "string" then package_path else .source |= package_path end)
  end
' "$repo/pi/agent/settings.json" > "$stage/settings.json"
diff_dir="$repo/pi/node_modules/pi-diff-review/src/diff"
upstream="$diff_dir/source-upstream.ts"
[[ -f "$upstream" ]] || upstream="$diff_dir/source.ts"
if command -v sha256sum >/dev/null; then
  diff_hash="$(sha256sum "$upstream")"
else
  diff_hash="$(shasum -a 256 "$upstream")"
fi
[[ "${diff_hash%% *}" == 590f16de0b302b25621ae1fbe7b07f768f397353286ec6505b47f29224d042cf ]] || {
  echo 'pi-diff-review source changed; review the portable diff override before deploying.' >&2
  exit 1
}
if [[ "$upstream" != "$diff_dir/source-upstream.ts" ]]; then
  cp "$upstream" "$diff_dir/source-upstream.ts"
fi
cp "$repo/pi/overrides/diff-source.ts" "$diff_dir/source.ts.portable"
mv "$diff_dir/source.ts.portable" "$diff_dir/source.ts"
review_root="$repo/pi/node_modules/pi-diff-review/src"
review_dir="$review_root/review"
jq -e '.version == "0.1.26"' "$review_root/../package.json" >/dev/null || {
  echo 'pi-diff-review version changed; review the portable UI adapter before deploying.' >&2
  exit 1
}
if [[ ! -f "$review_root/index-upstream.ts" ]]; then
  cp "$review_root/index.ts" "$review_root/index-upstream.ts"
fi
if [[ ! -f "$review_dir/component-upstream.ts" ]]; then
  cp "$review_dir/component.ts" "$review_dir/component-upstream.ts"
fi
cp "$review_dir/component-upstream.ts" "$stage/component.ts"
cp "$review_root/index-upstream.ts" "$stage/index.ts"
(cd "$stage"; git apply "$repo/pi/patches/diff-review-colors.patch"; git apply "$repo/pi/patches/diff-review-ui.patch")
cp "$repo/pi/overrides/diff-ui.ts" "$stage/diff-ui.ts"
mv "$stage/diff-ui.ts" "$review_root/diff-ui.ts"
mv "$stage/index.ts" "$review_root/index.ts"
mv "$stage/component.ts" "$review_dir/component.ts"
quotas_dir="$repo/pi/node_modules/@latentminds/pi-quotas"
jq -e '.version == "0.5.0"' "$quotas_dir/package.json" >/dev/null || {
  echo 'pi-quotas version changed; review the portable quota patch before deploying.' >&2
  exit 1
}
if [[ ! -d "$quotas_dir/src-upstream" ]]; then
  cp -R "$quotas_dir/src" "$quotas_dir/src-upstream"
fi
mkdir -p "$stage/quotas"
cp -R "$quotas_dir/src-upstream" "$stage/quotas/src"
(cd "$stage/quotas"; git apply "$repo/pi/patches/quotas.patch")
cp -R "$stage/quotas/src/." "$quotas_dir/src/"
config_ref="$(jq -r '.[] | select(.name == "pi-config") | .ref' "$repo/pi/upstream.json")"
mkdir -p "$agent/extensions"
for extension in browser prompt-snippets web-fetch web-search; do
  target="$agent/extensions/$extension"
  if [[ -L "$target" || ( -e "$target/index.ts" && ! -L "$target/index.ts" ) || ( -e "$target/node_modules" && ! -L "$target/node_modules" ) ]]; then
    printf 'Cannot deploy %s: unmanaged extension. Move it aside and rerun setup.\n' "$target" >&2
    exit 1
  fi
  ln -s "$repo/pi/upstream/pi-config-$config_ref/extensions/$extension/index.ts" "$stage/$extension"
done
for extension in browser prompt-snippets web-fetch web-search; do
  mkdir -p "$agent/extensions/$extension"
  rm -f "$agent/extensions/$extension/index.ts"
  mv "$stage/$extension" "$agent/extensions/$extension/index.ts"
  rm -f "$agent/extensions/$extension/node_modules"
  ln -s "$repo/pi/node_modules" "$agent/extensions/$extension/node_modules"
done
bash "$repo/pi/search-auth.sh" "$agent"
bash "$repo/pi/mcp-import.sh" "$agent"
bash "$repo/pi/credential-prompts.sh" "$agent"
mv "$stage/settings.json" "$agent/settings.json"
# Only repository-owned paths are overwritten; never remove private state.
while IFS= read -r -d '' source; do
  relative="${source#"$repo/pi/agent/"}"
  mkdir -p "$(dirname -- "$agent/$relative")"
  cp "$source" "$agent/$relative"
done < "$stage/resources"
for entry in \
  'extensions/subagent/config.json:ff02ed2fb474b96db9e205864dea567e83210dbbb267069aa60cd48144ea3395' \
  'web-search.json:5a34214ecaab443fc72b758d32c130e2a88167b55c4030b809e6eb917f67d7dd'; do
  path="$agent/${entry%%:*}"
  [[ -f "$path" && ! -L "$path" ]] || continue
  if command -v sha256sum >/dev/null; then hash="$(sha256sum "$path")"; else hash="$(shasum -a 256 "$path")"; fi
  [[ "${hash%% *}" != "${entry#*:}" ]] || rm "$path"
done
if [[ -z "${CONFIG_PI_HOME:-}" ]]; then
  bash "$repo/pi/install-command.sh" "$CONFIG_PI_COMMAND_PATH"
fi
