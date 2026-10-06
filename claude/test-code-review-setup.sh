#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
umask 077
work="$(mktemp -d "${TMPDIR:-/tmp}/code-review-setup.XXXXXX")"
trap 'printf "Code-review setup proof: %s\n" "$work"' EXIT
legacy="${CODE_REVIEW_LEGACY_FIXTURE:-}"
if [[ -z "$legacy" ]]; then
  # Pin the shipped bundle, not HEAD, so this remains a migration regression test.
  legacy="$work/legacy"
  mkdir -p "$legacy/references"
  for relative in SKILL.md references/{actions,angles,levels,origin,scope}.md; do
    git -C "$repo" show "2c49ef7:claude/skills/code-review/$relative" > "$legacy/$relative"
  done
fi
export HOME="$work/home"
source_skill="$repo/claude/skills/code-review"
target="$HOME/.claude/skills/code-review"
command_path="$HOME/.claude/commands/code-review.md"
bash "$repo/claude/setup.sh"
diff -qr "$source_skill" "$target"
cmp "$repo/claude/commands/code-review.md" "$command_path"
for ref in levels scope angles actions origin; do
  [[ -s "$target/references/$ref.md" ]]
  grep -Fq "references/$ref.md" "$target/SKILL.md"
done
bash "$repo/claude/setup.sh"
diff -qr "$source_skill" "$target"
printf '\nCustom review policy\n' >> "$target/SKILL.md"
printf 'Custom command\n' > "$command_path"
rm "$target/references/angles.md"
cp "$target/SKILL.md" "$work/custom-skill"
bash "$repo/claude/setup.sh"
cmp "$work/custom-skill" "$target/SKILL.md"
[[ ! -e "$target/references/angles.md" ]]
[[ "$(< "$command_path")" == 'Custom command' ]]
rm -rf "$target"
mkdir "$work/external"
printf 'External skill\n' > "$work/external/SKILL.md"
ln -s "$work/external" "$target"
rm "$command_path"
printf 'External command\n' > "$work/external-command"
ln -s "$work/external-command" "$command_path"
bash "$repo/claude/setup.sh"
[[ -L "$target" && -L "$command_path" ]]
[[ "$(< "$target/SKILL.md")" == 'External skill' ]]
[[ "$(< "$command_path")" == 'External command' ]]
printf '%s\n' 'PASS: code-review skill, references and alias seed correctly; repeated setup preserves customizations, missing references and symlinks.'
if [[ -n "$legacy" ]]; then
  [[ -d "$legacy" ]]
  if command -v shasum >/dev/null; then digest="$(shasum -a 256 < "$legacy/SKILL.md")"; else digest="$(sha256sum < "$legacy/SKILL.md")"; fi
  case "${digest%% *}" in
    f7136d7e31e53cde8f1bf0cc0583031ad967855e89616c0c515049c0d48a788a) version=final-report-v1 ;;
    2d76f548e597936f4d8bb9a78e91e86f320bedec676722190593d60218ea1965) version=seed-v1 ;;
    *) echo 'Unknown legacy fixture' >&2; exit 1 ;;
  esac
  backup="$HOME/.claude/code-review-skill-backup-$version"
  for mode in exact custom reference missing extra symlink conflict prior-backup; do
    rm -rf "$HOME"
    mkdir -p "$HOME/.claude/skills"
    cp -R "$legacy" "$target"
    case "$mode" in
      custom) printf '\nCustom policy\n' >> "$target/SKILL.md" ;;
      reference) printf '\nCustom policy\n' >> "$target/references/actions.md" ;;
      missing) rm "$target/references/scope.md" ;;
      prior-backup) mkdir "$HOME/.claude/code-review-skill-backup-older"; printf 'Keep\n' > "$HOME/.claude/code-review-skill-backup-older/sentinel" ;;
      extra) mkdir "$target/notes" ;;
      symlink) rm "$target/references/angles.md"; ln -s "$legacy/references/angles.md" "$target/references/angles.md" ;;
      conflict) mkdir "$backup" ;;
    esac
    rm -rf "$work/expected"
    cp -R "$target" "$work/expected"
    bash "$repo/claude/setup.sh"
    if [[ "$mode" == exact || "$mode" == prior-backup ]]; then
      diff -qr "$legacy" "$backup/code-review"
      diff -qr "$source_skill" "$target"
      [[ -n "$(find "$backup" -prune -perm 700 -print)" ]]
      bash "$repo/claude/setup.sh"
      diff -qr "$source_skill" "$target"
      diff -qr "$legacy" "$backup/code-review"
      if [[ "$mode" == prior-backup ]]; then
        [[ "$(< "$HOME/.claude/code-review-skill-backup-older/sentinel")" == Keep ]]
      fi
    else
      diff -qr "$work/expected" "$target"
      [[ ! -e "$backup/code-review" ]]
    fi
  done
  printf '%s\n' 'PASS: supplied legacy bundle migrates with a private backup; customizations, extra content, symlinks and backup conflicts are preserved.'
fi
