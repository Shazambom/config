#!/usr/bin/env bash

set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ $# -gt 1 || ( $# -eq 1 && "$1" != "--pi" ) ]]; then
  echo 'Usage: init.sh [--pi] (default: Pi and Neovim; --pi: Pi only)' >&2
  exit 1
fi

printf '%s\n' 'Setting up Pi...' >&2
# Capture the user's npm prefix before selecting our private runtime. Isolated
# test/custom homes must not modify the user's global installation.
pi_global_prefix=''
export CONFIG_PI_INSTALL_GLOBAL=0
export CONFIG_PI_GLOBAL_NEEDS_NODE=0
if [[ -z "${CONFIG_PI_HOME:-}" ]] && ! command -v pi >/dev/null 2>&1; then
  pi_global_prefix="$HOME/.local"
  if command -v npm >/dev/null 2>&1; then
    pi_global_prefix="$(npm prefix -g)"
  else
    export CONFIG_PI_GLOBAL_NEEDS_NODE=1
  fi
  export CONFIG_PI_INSTALL_GLOBAL=1
fi
export CONFIG_PI_GLOBAL_PREFIX="$pi_global_prefix"
# Keep the private Pi runtime PATH out of the Neovim/global tool installers.
(
  source "$repo/pi/runtime.sh"
  ensure_pi_runtime
  source "$repo/pi/jq.sh"
  ensure_pi_jq
  bash "$repo/pi/setup.sh"
  if [[ "$CONFIG_PI_GLOBAL_NEEDS_NODE" == 1 ]]; then
    mkdir -p "$pi_global_prefix/bin"
    if [[ ! -e "$pi_global_prefix/bin/node" ]]; then
      ln -s "$pi_node_dir/bin/node" "$pi_global_prefix/bin/node"
    fi
  fi
)
if [[ -n "$pi_global_prefix" ]]; then
  case ":$PATH:" in
    *":$pi_global_prefix/bin:"*) ;;
    *) printf 'Add %s/bin to your shell PATH to run pi directly.\n' "$pi_global_prefix" >&2 ;;
  esac
fi
printf '%s\n' 'Pi setup complete.' >&2
[[ "${1:-}" != "--pi" ]] || exit 0

printf '%s\n' 'Setting up Neovim...' >&2
cd "$repo"

mkdir -p ~/.config/nvim
cp ./init.vim ~/.config/nvim/init.vim
cp ./coc-settings.json ~/.config/nvim/coc-settings.json

# tree-sitter CLI is required by nvim-treesitter (main branch) to build parsers
command -v tree-sitter >/dev/null 2>&1 || npm install -g tree-sitter-cli

sh -c 'curl -fLo "${XDG_DATA_HOME:-$HOME/.local/share}"/nvim/site/autoload/plug.vim --create-dirs \
       https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim'

mkdir -p "$HOME/.local/share/nvim/plugged"

# PlugUpdate (not PlugInstall) so existing checkouts follow branch changes,
# e.g. nvim-treesitter master -> main
nvim --headless +"PlugUpdate --sync" +PlugClean! +qall

echo "vim-plug plugins installed"

nvim --headless +"CocInstall -sync coc-pyright coc-tsserver coc-go coc-sql coc-json" +qall

echo "coc extensions installed"

nvim --headless +"CocUpdateSync" +qall

echo "coc extensions updated"

# GOBIN pinned so gopls lands at the path coc-settings.json points to,
# regardless of the machine's GOPATH/GOBIN
GOBIN="$HOME/go/bin" go install golang.org/x/tools/gopls@latest

echo "gopls updated"

# delve, used by nvim-dap-go for debugging
GOBIN="$HOME/go/bin" go install github.com/go-delve/delve/cmd/dlv@latest

echo "dlv updated"

nvim --headless "+lua require('nvim-treesitter').install({'go','python','typescript','javascript','rust','json','sql','lua'}):wait(600000)" +qall

echo "treesitter parsers updated"

echo "nvim install complete"
