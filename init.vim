set path+=**
set modelines=0
set autoread
autocmd FocusGained,BufEnter * silent! checktime
set encoding=utf-8
set visualbell
set backspace=indent,eol,start
set nobackup
set noswapfile
set relativenumber
set number
set scrolloff=2
set expandtab tabstop=2 shiftwidth=2 softtabstop=2
set autoindent
set listchars=tab:>-
set showmode showcmd
set ttyfast lazyredraw
set showmatch
set hlsearch incsearch ignorecase smartcase
" set autochdir  " disabled — breaks neo-tree
set hidden
set wildmenu wildmode=list:longest,full
set laststatus=2 statusline=%F
set clipboard=unnamed
set foldmethod=indent
set foldnestmax=1
set foldlevelstart=1
filetype plugin indent on

" Plugins, syntax, and colors
" ---------------------------------------------------------------------------
" vim-plug
" https://github.com/junegunn/vim-plug
" Specify a directory for plugins
" - For Neovim: ~/.local/share/nvim/plugged
" - Avoid using standard Vim directory names like 'plugin'
call plug#begin('~/.local/share/nvim/plugged')

" Make sure to use single quotes
" Install with `:PlugInstall`

Plug 'neoclide/coc.nvim', {'branch': 'release'}
let g:coc_global_extensions = ['coc-pyright', 'coc-tsserver', 'coc-go', 'coc-sql', 'coc-json']


Plug 'folke/tokyonight.nvim', { 'branch': 'main' }

Plug 'doums/darcula'

" https://github.com/itchyny/lightline.vim
Plug 'itchyny/lightline.vim'

" https://github.com/tpope/vim-commentary
Plug 'tpope/vim-commentary'

" https://github.com/tpope/vim-surround
Plug 'tpope/vim-surround'

" https://github.com/nvim-neo-tree/neo-tree.nvim
Plug 'nvim-lua/plenary.nvim'
Plug 'MunifTanjim/nui.nvim'
Plug 'nvim-tree/nvim-web-devicons'
Plug 'nvim-neo-tree/neo-tree.nvim', { 'branch': 'v3.x' }

" https://github.com/lewis6991/gitsigns.nvim
Plug 'lewis6991/gitsigns.nvim'

" https://github.com/APZelos/blamer.nvim
Plug 'APZelos/blamer.nvim'

" https://github.com/fenetikm/falcon/wiki/Installation
Plug 'fenetikm/falcon'

" https://github.com/macguirerintoul/night_owl_light.vim
Plug 'macguirerintoul/night_owl_light.vim'

Plug 'catppuccin/nvim', { 'as': 'catppuccin' }

" https://github.com/nvim-treesitter/nvim-treesitter
Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}

" Initialize plugin system
call plug#end()

" Neo-tree setup
lua << EOF
local ok, neotree = pcall(require, "neo-tree")
if ok then
  neotree.setup({
    filesystem = {
      follow_current_file = { enabled = true },
      use_libuv_file_watcher = true,
      filtered_items = {
        hide_dotfiles = false,
        hide_gitignored = false,
      },
    },
    event_handlers = {{
      event = "file_opened",
      handler = function()
        require("neo-tree.sources.manager").navigate("filesystem")
      end,
    }},
    window = {
      position = "left",
      width = 35,
      mappings = {
        ["/"] = "filter_on_submit",
        ["<esc>"] = "clear_filter",
      },
    },
  })
  vim.api.nvim_create_autocmd("VimEnter", {
    callback = function()
      vim.cmd("Neotree focus")
    end,
  })
end

local ok2, gitsigns = pcall(require, "gitsigns")
if ok2 then
  gitsigns.setup()
end

local ok3, tsconfigs = pcall(require, "nvim-treesitter.configs")
if ok3 then
  tsconfigs.setup({
    ensure_installed = { "go", "python", "typescript", "javascript", "rust", "json", "sql", "lua" },
    highlight = { enable = true },
  })
end
EOF

nnoremap <leader>e :Neotree toggle<CR>
nnoremap <silent> <C-e> :lua if vim.bo.filetype == 'neo-tree' then vim.cmd('wincmd p') else vim.cmd('Neotree focus') end<CR>
inoremap <silent> <C-e> <Esc>:lua if vim.bo.filetype == 'neo-tree' then vim.cmd('wincmd p') else vim.cmd('Neotree focus') end<CR>

syntax enable
" Neovim only
set termguicolors 

" colorscheme tokyonight-day
" colorscheme tokyonight-moon
colorscheme darcula
" Show character column
set colorcolumn=80

" lightline config - add file 'absolutepath'
" Delete colorscheme line below if using Dark scheme

let g:lightline = {
      \ 'colorscheme': 'PaperColor_light',
      \ 'active': {
      \   'left': [ [ 'mode', 'paste' ],
      \             [ 'readonly', 'absolutepath', 'modified' ] ]
      \ }
      \ }

let g:blamer_enabled = 1
" %a is the day of week, in case it's needed
let g:blamer_date_format = '%e %b %Y'
highlight Blamer guifg=darkorange
nnoremap <C-d> <C-d>zz
nnoremap <C-u> <C-u>zz
set ruler
highlight LineNr term=NONE cterm=NONE ctermfg=DarkGrey ctermbg=NONE gui=NONE guifg=DarkGrey guibg=NONE
set incsearch
set nolist

inoremap <silent><expr> <Tab> pumvisible() ? coc#_select_confirm() : "\<Tab>"
inoremap <silent><expr> <S-Tab> pumvisible() ? "\<C-p>" : "\<S-Tab>"

nmap <silent> gd <Plug>(coc-definition)
nmap <silent> gr <Plug>(coc-references)
nmap <silent> gi <Plug>(coc-implementation)
nmap <silent> gy <Plug>(coc-type-definition)
function! s:RenameAndSave() abort
  if CocAction('rename')
    silent! wa
  endif
endfunction
nnoremap <silent> gn :call <SID>RenameAndSave()<CR>

nnoremap <silent> K :call CocActionAsync('doHover')<CR>
nnoremap <silent> <C-q> :silent! checktime<CR>:silent CocRestart<CR>
nnoremap <C-s> :w<CR>
inoremap <C-s> <Esc>:w<CR>

nnoremap <silent> <Esc> :noh<CR>

