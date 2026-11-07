#!/usr/bin/env bash
# A private runnable package with private type assets for the shared tool pipeline.
# Never patch through a dependency symlink into the installed runtime.
set -euo pipefail
original="$(cd -- "${1:?source package}" && pwd)"
candidate="${2:?new private package directory}"
[[ ! -e "$candidate" ]] || { echo 'Candidate directory already exists' >&2; exit 1; }
mkdir -p "$candidate/node_modules/@earendil-works"
cp -R "$original/dist" "$original/package.json" "$candidate/"
for dependency in "$original"/node_modules/*; do
  name="$(basename "$dependency")"
  [[ "$name" != @earendil-works ]] || continue
  ln -s "$dependency" "$candidate/node_modules/$name"
done
for dependency in "$original"/node_modules/@earendil-works/*; do
  name="$(basename "$dependency")"
  if [[ "$name" == pi-agent-core ]]; then
    # Resolve a source symlink before copying; destination must be a real tree.
    source_dir="$(cd -- "$dependency" && pwd -P)"
    cp -R "$source_dir" "$candidate/node_modules/@earendil-works/$name"
  else
    ln -s "$dependency" "$candidate/node_modules/@earendil-works/$name"
  fi
done
[[ ! -L "$candidate/node_modules/@earendil-works/pi-agent-core" ]]
