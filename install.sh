#!/bin/sh
# Installs agent-diff for VS Code, vscode-neovim, omp and Claude Code. You can run it again.
set -eu
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "agent-diff: install Node.js first" >&2; exit 1; }

echo "1/5 Script: ~/.local/bin/agent-diff"
mkdir -p "$HOME/.local/bin"
install -m 755 bin/agent-diff "$HOME/.local/bin/agent-diff"

echo "2/5 VS Code extension"
if command -v code >/dev/null; then
  (cd vscode && npx --yes --loglevel=error @vscode/vsce@3 package --skip-license --allow-missing-repository -o ../agent-diff.vsix >/dev/null)
  code --install-extension agent-diff.vsix --force
else
  echo "    skipped: the 'code' command is not on PATH"
fi

# vscode-neovim sends the arrows of normal mode to Neovim, so the review keys need a Neovim mapping too.
# Neovim runs each plugin/*.lua file of its site folder at startup, and lazy.nvim keeps that folder.
# The site folder leaves the Neovim config folder alone, so you can still clone a config into it later.
nvim_site="${XDG_DATA_HOME:-$HOME/.local/share}/${NVIM_APPNAME:-nvim}/site/plugin"
echo "3/5 Neovim mappings for vscode-neovim: $nvim_site/agent-diff.lua"
if command -v nvim >/dev/null || { command -v code >/dev/null && code --list-extensions | grep -qix 'asvetliakov.vscode-neovim'; }; then
  mkdir -p "$nvim_site"
  cp nvim/agent-diff.lua "$nvim_site/"
else
  echo "    skipped: neither nvim nor vscode-neovim found"
fi

echo "4/5 omp extension"
if [ -d "$HOME/.omp/agent" ]; then
  mkdir -p "$HOME/.omp/agent/extensions"
  cp omp/agent-diff.ts "$HOME/.omp/agent/extensions/"
else
  echo "    skipped: ~/.omp/agent not found"
fi

echo "5/5 Claude Code hooks"
if [ -d "$HOME/.claude" ]; then
  # Adds the hooks once. Keeps your other hooks. Backs up the old file to settings.json.bak.
  node -e '
    const fs = require("fs");
    const [file, add] = process.argv.slice(1);
    let s = {};
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, file + ".bak");
      s = JSON.parse(fs.readFileSync(file, "utf8"));
    }
    s.hooks ??= {};
    for (const [event, groups] of Object.entries(JSON.parse(fs.readFileSync(add, "utf8")).hooks)) {
      const list = (s.hooks[event] ??= []);
      if (!JSON.stringify(list).includes("agent-diff")) list.push(...groups);
    }
    fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
  ' "$HOME/.claude/settings.json" claude/hooks.json
else
  echo "    skipped: ~/.claude not found"
fi

echo "Done. Reload your VS Code windows."
