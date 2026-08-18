#!/usr/bin/env bash


mkdir -p ~/.config/nvim
cp ./init.vim ~/.config/nvim/init.vim

sh -c 'curl -fLo "${XDG_DATA_HOME:-$HOME/.local/share}"/nvim/site/autoload/plug.vim --create-dirs \
       https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim'

mkdir -p "$HOME/.local/share/nvim/plugged"

nvim --headless +"PlugInstall --sync" +PlugClean! +qall

echo "vim-plug plugins installed"

nvim --headless +"CocInstall -sync coc-pyright coc-tsserver coc-go coc-sql coc-json" +qall

echo "coc extensions installed"

nvim --headless +"CocUpdateSync" +qall

echo "coc extensions updated"

nvim --headless +"CocCommand go.install.gopls" +qall

echo "gopls updated"

nvim --headless +"TSUpdateSync" +qall

echo "treesitter parsers updated"

echo "nvim install complete"
