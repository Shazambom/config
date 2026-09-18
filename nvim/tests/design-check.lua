local target = vim.fn.bufnr(vim.env.DESIGN_EDITOR_FILE)
assert(target >= 0, 'design buffer not loaded')
local window = vim.fn.bufwinid(target)
if window >= 0 then vim.api.nvim_set_current_win(window) else vim.api.nvim_set_current_buf(target) end
local report = { file = vim.api.nvim_buf_get_name(0), filetype = vim.bo.filetype }
local out = assert(vim.env.DESIGN_EDITOR_REPORT)
local function save()
  vim.fn.writefile({ vim.json.encode(report) }, out)
end
local function action(name)
  local ok, value = pcall(vim.fn.CocAction, name)
  if ok then return value end
  report.last_coc_error = tostring(value)
  return nil
end
local function await(label, callback)
  assert(vim.wait(120000, callback, 300), 'Timed out: ' .. label)
end
local function diagnostics()
  local result = action('diagnosticList')
  if type(result) ~= 'table' then return nil end
  local current = {}
  for _, item in ipairs(result) do
    if item.file == report.file then table.insert(current, item) end
  end
  return current
end
local function clean(items)
  if not items then return false end
  for _, item in ipairs(items) do
    if item.level <= 2 or item.message:find('MissingDesignType', 1, true) then return false end
  end
  return true
end
local ok, err = xpcall(function()
  assert(report.filetype == vim.env.DESIGN_EXPECT_FILETYPE, 'wrong filetype')
  report.rustup_auto_install = vim.env.RUSTUP_AUTO_INSTALL
  assert(report.rustup_auto_install == '0', 'editor may auto-install Rust toolchains')
  await('Coc initialized', function() return vim.g.coc_service_initialized == 1 end)
  await('OrderReceipt document symbol', function()
    report.symbols = action('documentSymbols')
    return type(report.symbols) == 'table' and vim.json.encode(report.symbols):find('OrderReceipt', 1, true) ~= nil
  end)
  report.services = action('services')
  local running = false
  for _, service in ipairs(report.services or {}) do
    if service.id == vim.env.DESIGN_EXPECT_SERVICE and service.state == 'running' then running = true end
  end
  assert(running, 'expected Coc service not running')
  report.processes = {}
  local descendants = { [vim.fn.getpid()] = true }
  local processes = vim.fn.systemlist({ 'ps', '-axo', 'pid=,ppid=,comm=' })
  for _ = 1, 5 do
    for _, process in ipairs(processes) do
      local pid, ppid, executable = process:match('^%s*(%d+)%s+(%d+)%s+(.+)$')
      if pid and descendants[tonumber(ppid)] and not descendants[tonumber(pid)] then
        descendants[tonumber(pid)] = true
        table.insert(report.processes, { pid = tonumber(pid), ppid = tonumber(ppid), executable = executable })
      end
    end
  end
  if report.filetype == 'go' or report.filetype == 'rust' then
    local executable = report.filetype == 'go' and 'gopls' or 'rust-analyzer'
    local found = false
    for _, process in ipairs(report.processes) do
      if process.executable:find(executable, 1, true) then
        assert(vim.uv.kill(process.pid, 0), 'language server process is not alive')
        found = true
      end
    end
    assert(found, executable .. ' process not observed')
  end
  assert(vim.treesitter.highlighter.active[vim.api.nvim_get_current_buf()], 'Tree-sitter highlighting inactive')
  local original = vim.api.nvim_buf_get_lines(0, 0, -1, false)
  report.captures = {}
  for row, line in ipairs(original) do
    if line:match('^type OrderReceipt') or line:match('^class OrderReceipt') or line:match('^pub struct OrderReceipt') then
      local col = assert(line:find('OrderReceipt', 1, true)) - 1
      for _, capture in ipairs(vim.treesitter.get_captures_at_pos(0, row - 1, col)) do
        local group = '@' .. capture.capture .. '.' .. capture.lang
        local color = vim.api.nvim_get_hl(0, { name = group, link = false })
        table.insert(report.captures, { capture = capture.capture, language = capture.lang, group = group, color = color })
      end
    end
  end
  assert(#report.captures > 0, 'no declaration captures')
  local colored = false
  for _, capture in ipairs(report.captures) do
    if capture.color.fg and capture.color.fg ~= vim.api.nvim_get_hl(0, { name = 'Normal', link = false }).fg then colored = true end
  end
  assert(colored, 'declaration capture has no distinct foreground')
  await('initial clean diagnostics', function()
    report.initial_diagnostics = diagnostics()
    return clean(report.initial_diagnostics)
  end)
  local negative = ({ go = 'type DesignProbe MissingDesignType', python = 'design_probe: MissingDesignType', rust = 'pub type DesignProbe = MissingDesignType;' })[report.filetype]
  vim.api.nvim_buf_set_lines(0, -1, -1, false, { '', negative })
  vim.cmd('write')
  await('negative-control semantic diagnostic', function()
    report.negative_diagnostics = diagnostics()
    return report.negative_diagnostics and vim.json.encode(report.negative_diagnostics):find('MissingDesignType', 1, true) ~= nil
  end)
  vim.api.nvim_buf_set_lines(0, 0, -1, false, original)
  vim.cmd('write')
  await('diagnostics clear after restoration', function()
    report.restored_diagnostics = diagnostics()
    return clean(report.restored_diagnostics)
  end)
  report.passed = true
end, debug.traceback)
if not ok then report.error = tostring(err) end
save()
if ok then vim.cmd('qa!') else vim.cmd('cquit 1') end
