# agent-diff

After each omp or Claude Code run, VS Code opens an inline diff for each file the agent changed.

## Install

```bash
./install.sh
```

The script installs each part and skips a tool that you do not have:

1. `bin/agent-diff` to `~/.local/bin/`
2. The VS Code extension, packaged with `npx @vscode/vsce`
3. `nvim/agent-diff.lua` to `~/.config/nvim/plugin/`, for the [vscode-neovim](https://github.com/vscode-neovim/vscode-neovim) extension. Neovim outside VS Code does not use it.
4. `omp/agent-diff.ts` to `~/.omp/agent/extensions/`
5. The hooks from `claude/hooks.json` into `~/.claude/settings.json`. The old file goes to `settings.json.bak`.

You can run it again. It does not add the hooks twice. Reload your VS Code windows after you install.

## Use

These keys and buttons work only in an agent diff tab. Other tabs keep the normal VS Code keys.

An agent diff tab has two modes:

- **Review**: each agent run starts in this mode. The plain keys in the table move through the changes and files.
- **Edit**: the editor works as usual. Only the `cmd+alt` keys work.

To switch the mode, press `cmd+alt+enter` (`ctrl+alt+enter`), or click the Review / Edit button in the status bar. Nothing else switches it.

With vscode-neovim, the plain keys work in normal mode. Neovim gets these keys before VS Code does, so `nvim/agent-diff.lua` maps them in Neovim. Outside an agent diff tab, and in edit mode, each key keeps its old mapping.

A notification at the bottom right shows the keys for the current mode. Click a key in it to run that action.
Esc or "Cancel" hides the notification. The next mode switch or agent diff tab shows it again.

| Action | Title bar button | Review mode | Edit mode (macOS) | Edit mode (Linux, Windows) |
|---|---|---|---|---|
| Previous / next change in the file | VS Code built-in ↑ ↓ | `up` / `down` | `cmd+alt+up` / `cmd+alt+down` | `ctrl+alt+up` / `ctrl+alt+down` |
| Previous / next file | ← → | `left` / `right` | `cmd+alt+left` / `cmd+alt+right` | `ctrl+alt+left` / `ctrl+alt+right` |
| Dismiss this file | ✓ | `backspace` | `cmd+alt+backspace` | `ctrl+alt+backspace` |
| Dismiss all files | ✓✓ | `shift+backspace` | `cmd+alt+shift+backspace` | `ctrl+alt+shift+backspace` |

The `cmd+alt` keys also work in review mode.

Dismiss closes the tab and removes the file from the review. The change of the agent stays in the file.

The commands are also in the command palette under "Agent Diff". Use the keys in Zen mode if the editor title bar is hidden.

## How it works

- `agent-diff snapshot` runs before the agent. It records the work tree as a git tree object, through a private index.
- `agent-diff done` runs after the agent. If the tree changed, it writes both tree hashes to `.git/agent-diff/review`.
- Each VS Code window watches the git folder of its own workspace, so the review opens in the correct window.
- If the folder is not a git repo, both sides use each git repo one level down. You can open `~/projects` in VS Code and run the agent there.

It makes no commits, refs, stash entries or changes to your staged files. Git removes the unused tree objects with `git gc` after 2 weeks.

## Limits

- It works in a git repo, or in a folder with git repos one level down. Deeper repos are not found. It does not show changes to gitignored files.
- A new run in a repo replaces the files of that repo that you did not review yet.
- During a review, it sets `diffEditor.renderSideBySide` to `false`. "Dismiss all" puts back your old value.
- Large untracked files that git does not ignore make each snapshot slower.

## Test

```bash
./test.sh
```
