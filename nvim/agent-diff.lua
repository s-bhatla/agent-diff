-- Agent Diff keys for vscode-neovim.
-- vscode-neovim sends the arrows and backspace of normal mode to Neovim before VS Code keybindings see them.
-- So in review mode these mappings run the Agent Diff actions here. Elsewhere each key keeps its old mapping.
-- The VS Code extension sets vim.g.agent_diff_reviewing while an agent diff tab is active in review mode.
if not vim.g.vscode then
  return
end

local actions = {
  ["<Up>"] = "workbench.action.compareEditor.previousChange",
  ["<Down>"] = "workbench.action.compareEditor.nextChange",
  ["<Left>"] = "agentDiff.prev",
  ["<Right>"] = "agentDiff.next",
  ["<BS>"] = "agentDiff.dismiss",
  ["<S-BS>"] = "agentDiff.dismissAll",
}

local function install()
  for lhs, action in pairs(actions) do
    -- Keep the old mapping (LazyVim maps <Up>/<Down> to gk/gj) under a <Plug> name, else the built-in key.
    local plug = "<Plug>(agent-diff-fallback-" .. lhs:gsub("[<>]", "") .. ")"
    local old = vim.fn.maparg(lhs, "n", false, true)
    if old.lhs then
      old.lhs, old.lhsraw, old.lhsrawalt = plug, vim.keycode(plug), nil
      vim.fn.mapset("n", false, old)
    else
      vim.keymap.set("n", plug, lhs)
    end
    vim.keymap.set("n", lhs, function()
      if vim.g.agent_diff_reviewing then
        require("vscode").action(action)
        return ""
      end
      return plug
    end, { expr = true, remap = true, desc = "Agent Diff: " .. action })
  end
end

-- LazyVim sets its keymaps on VeryLazy, after this file runs, so wait for it.
if package.loaded.lazy and vim.v.vim_did_enter == 0 then
  vim.api.nvim_create_autocmd("User", { pattern = "VeryLazy", once = true, callback = install })
else
  install()
end
