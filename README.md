# agent-diff

After each omp or Claude Code run, VS Code opens an inline diff for each file the agent changed.

## Install

1. Copy the script:
   ```bash
   install -m 755 bin/agent-diff ~/.local/bin/agent-diff
   ```
2. Install the VS Code extension:
   ```bash
   cd vscode && npx @vscode/vsce@3 package --skip-license --allow-missing-repository -o ../agent-diff.vsix && cd .. && code --install-extension agent-diff.vsix
   ```
3. For omp, copy the adapter:
   ```bash
   cp omp/agent-diff.ts ~/.omp/agent/extensions/
   ```
4. For Claude Code, merge `claude/hooks.json` into the `hooks` key of `~/.claude/settings.json`.
5. Reload VS Code windows.

## Use

| Action | Button | Key |
|---|---|---|
| Previous file | ← | `ctrl+alt+p` |
| Next file | → | `ctrl+alt+n` |
| Dismiss this file | ✓ | `ctrl+alt+d` |
| Dismiss all files | ✓✓ | `ctrl+alt+shift+d` |
| Next / previous change in the file | VS Code built-in ↓ ↑ | `alt+f5` / `shift+alt+f5` |

The commands are also in the command palette under "Agent Diff". Use the keys in Zen mode if the editor title bar is hidden.

## How it works

- `agent-diff snapshot` runs before the agent. It records the work tree as a git tree object, through a private index.
- `agent-diff done` runs after the agent. If the tree changed, it writes both tree hashes to `.git/agent-diff/review`.
- Each VS Code window watches the git folder of its own workspace, so the review opens in the correct window.

It makes no commits, refs, stash entries or changes to your staged files. Git removes the unused tree objects with `git gc` after 2 weeks.

## Limits

- It works only in git repos. It does not show changes to gitignored files.
- A new run replaces the list of files that you did not review yet.
- During a review, it sets `diffEditor.renderSideBySide` to `false`. "Dismiss all" puts back your old value.
- Large untracked files that git does not ignore make each snapshot slower.

## Test

```bash
./test.sh
```
