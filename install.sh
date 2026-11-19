#!/bin/sh
# Installs agent-diff for VS Code, omp and Claude Code. You can run it again.
set -eu
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "agent-diff: install Node.js first" >&2; exit 1; }

echo "1/4 Script: ~/.local/bin/agent-diff"
mkdir -p "$HOME/.local/bin"
install -m 755 bin/agent-diff "$HOME/.local/bin/agent-diff"

echo "2/4 VS Code extension"
if command -v code >/dev/null; then
  (cd vscode && npx --yes --loglevel=error @vscode/vsce@3 package --skip-license --allow-missing-repository -o ../agent-diff.vsix >/dev/null)
  code --install-extension agent-diff.vsix --force
else
  echo "    skipped: the 'code' command is not on PATH"
fi

echo "3/4 omp extension"
if [ -d "$HOME/.omp/agent" ]; then
  mkdir -p "$HOME/.omp/agent/extensions"
  cp omp/agent-diff.ts "$HOME/.omp/agent/extensions/"
else
  echo "    skipped: ~/.omp/agent not found"
fi

echo "4/4 Claude Code hooks"
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
