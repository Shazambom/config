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
Plug 'nvim-treesitter/nvim-treesitter', {'branch': 'main', 'do': ':TSUpdate'}

" Debugging (nvim-dap stack; dlv is installed by init.sh)
Plug 'mfussenegger/nvim-dap'
Plug 'nvim-neotest/nvim-nio'
Plug 'rcarriga/nvim-dap-ui'
Plug 'theHamsta/nvim-dap-virtual-text'
Plug 'leoluz/nvim-dap-go'

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

-- nvim-treesitter main branch: install() replaces configs.setup, and
-- highlighting must be started per-buffer via vim.treesitter.start
local ok3, ts = pcall(require, "nvim-treesitter")
if ok3 then
  local ts_langs = { "go", "python", "typescript", "javascript", "rust", "json", "sql", "lua" }
  ts.install(ts_langs)
  vim.api.nvim_create_autocmd("FileType", {
    pattern = ts_langs,
    callback = function()
      pcall(vim.treesitter.start)
    end,
  })
end

-- Debugging: nvim-dap + dap-ui + dap-go
local okd, dap = pcall(require, "dap")
local oku, dapui = pcall(require, "dapui")
if okd and oku then
  dapui.setup()
  pcall(function() require("nvim-dap-virtual-text").setup() end)
  pcall(function() require("dap-go").setup() end)

  dap.listeners.after.event_initialized.dapui_config = function() dapui.open() end
  dap.listeners.before.event_terminated.dapui_config = function() dapui.close() end
  dap.listeners.before.event_exited.dapui_config = function() dapui.close() end
  dap.listeners.after.disconnect.dapui_config = function() dapui.close() end

  local function debug_smart()
    if vim.fn.expand("%"):match("_test%.go$") then
      require("dap-go").debug_test()
    else
      require("dap-go").debug_last_test()
    end
  end

  local overlay = {
    { "n", dap.step_over, "next" },
    { "s", dap.step_into, "into" },
    { "o", dap.step_out, "out" },
    { "c", dap.continue, "continue" },
    { "r", dap.run_to_cursor, "to-cursor" },
    { "b", dap.toggle_breakpoint, "break" },
    { "e", function() dapui.eval() end, "eval" },
    { "q", dap.terminate, "quit" },
  }
  local saved_maps = {}
  local function overlay_on()
    saved_maps = {}
    for i, m in ipairs(overlay) do
      saved_maps[i] = vim.fn.maparg(m[1], "n", false, true)
      vim.keymap.set("n", m[1], m[2], { desc = "dap: " .. m[3] })
    end
    vim.notify("DEBUG  n:next s:into o:out c:continue r:to-cursor b:break e:eval q:quit")
  end
  local function overlay_off()
    for i, m in ipairs(overlay) do
      pcall(vim.keymap.del, "n", m[1])
      local s = saved_maps[i]
      if s and s.lhs then pcall(vim.fn.mapset, "n", false, s) end
    end
    saved_maps = {}
  end
  dap.listeners.after.event_initialized.debug_keys = overlay_on
  dap.listeners.before.event_terminated.debug_keys = overlay_off
  dap.listeners.before.event_exited.debug_keys = overlay_off
  dap.listeners.after.disconnect.debug_keys = overlay_off

  -- Entry points: chords for speed, commands for discoverability
  vim.keymap.set("n", "<C-b>", dap.toggle_breakpoint, { desc = "dap: toggle breakpoint" })
  vim.keymap.set("n", "<C-t>", debug_smart, { desc = "dap: debug test / rerun last" })
  vim.api.nvim_create_user_command("Break", function() dap.toggle_breakpoint() end, {})
  vim.api.nvim_create_user_command("Cond", function()
    dap.set_breakpoint(vim.fn.input("Breakpoint condition: "))
  end, {})
  vim.api.nvim_create_user_command("Debug", debug_smart, {})
  vim.api.nvim_create_user_command("DebugUI", function() dapui.toggle() end, {})
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
function! s:RenameDone(err, result) abort
  if a:err isnot v:null
    echohl ErrorMsg | echomsg 'Rename failed: ' . string(a:err) | echohl None
  elseif a:result
    silent! wa
    echomsg 'Renamed and saved all buffers'
  else
    echohl WarningMsg
    echomsg 'Rename cancelled or rejected by the language server — run :messages for the reason'
    echohl None
  endif
endfunction
nnoremap <silent> gn :call CocActionAsync('rename', function('<SID>RenameDone'))<CR>

nnoremap <silent> K :call CocActionAsync('doHover')<CR>
nnoremap <silent> <C-q> :silent! checktime<CR>:silent CocRestart<CR>
nnoremap <C-s> :w<CR>
inoremap <C-s> <Esc>:w<CR>

nnoremap <silent> <Esc> :noh<CR>

