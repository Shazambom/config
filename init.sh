#!/usr/bin/env bash


mkdir -p ~/.config/nvim
cp ./init.vim ~/.config/nvim/init.vim

sh -c 'curl -fLo "${XDG_DATA_HOME:-$HOME/.local/share}"/nvim/site/autoload/plug.vim --create-dirs \
       https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim'

mkdir -p "$HOME/.local/share/nvim/plugged"

nvim --headless +PlugInstall +PlugClean! +qall

echo "nvim install complete"
