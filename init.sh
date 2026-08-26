#!/usr/bin/env bash


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

nvim --headless "+lua require('nvim-treesitter').install({'go','python','typescript','javascript','rust','json','sql','lua'}):wait(600000)" +qall

echo "treesitter parsers updated"

echo "nvim install complete"
