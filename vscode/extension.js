// Agent Diff: shows each file an agent changed as an inline diff, one at a time.
// Trigger: bin/agent-diff writes "<base-tree> <current-tree>" to .git/agent-diff/review.
const vscode = require('vscode');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCHEME = 'agent-diff';
const git = (cwd, args) => execFileSync('git', args, { cwd, maxBuffer: 1 << 30 });

let ctx;
let files = []; // { top, name, left, right }, from all watched repos
let pos = 0;

// Old side of each diff: file content from the snapshot tree, or empty.
function oldContent(uri) {
  const q = new URLSearchParams(uri.query);
  if (!q.get('tree')) return '';
  try {
    return git(q.get('repo'), ['show', `${q.get('tree')}:${q.get('rel')}`]).toString();
  } catch {
    return '';
  }
}

// Watches dir if it is a repo, else each git repo one level down (same rule as bin/agent-diff).
function watch(dir) {
  if (watchRepo(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && fs.existsSync(path.join(dir, e.name, '.git'))) watchRepo(path.join(dir, e.name));
  }
}

function watchRepo(dir) {
  let gd, top;
  try {
    [gd, top] = git(dir, ['rev-parse', '--absolute-git-dir', '--show-toplevel']).toString().trim().split('\n');
  } catch {
    return false; // not a git repo
  }
  const sig = path.join(gd, 'agent-diff');
  fs.mkdirSync(sig, { recursive: true }); // a watcher needs its folder to exist
  const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(sig), 'review'));
  const on = () => open(top, path.join(sig, 'review'));
  w.onDidCreate(on);
  w.onDidChange(on);
  ctx.subscriptions.push(w);
  return true;
}

// A new run replaces the files of its own repo only.
// ponytail: files you did not review from the last run of that repo drop out.
async function open(top, reviewFile) {
  let base, cur;
  try {
    [base, cur] = fs.readFileSync(reviewFile, 'utf8').trim().split(' ');
  } catch {
    return;
  }
  const out = git(top, ['diff', '--no-renames', '--name-status', '-z', base, cur]).toString().split('\0');
  const uri = (rel, tree) =>
    vscode.Uri.from({ scheme: SCHEME, path: '/' + rel, query: new URLSearchParams({ repo: top, tree, rel }).toString() });
  const added = [];
  for (let i = 0; i + 1 < out.length; i += 2) {
    const [status, rel] = [out[i], out[i + 1]];
    added.push({
      top,
      name: `${path.basename(top)}/${rel}`,
      left: status === 'A' ? uri(rel, '') : uri(rel, base),
      right: status === 'D' ? uri(rel, '') : vscode.Uri.file(path.join(top, rel)),
    });
  }
  if (!added.length) return;
  files = files.filter((f) => f.top !== top).concat(added);
  await start();
  await show(files.length - added.length);
}

async function show(i) {
  if (!files.length) return finish();
  pos = (i + files.length) % files.length; // wrap around at both ends
  const f = files[pos];
  await vscode.commands.executeCommand('vscode.diff', f.left, f.right, `${f.name} (agent ${pos + 1}/${files.length})`, {
    preview: true, // reuse one tab
  });
}

const ourTabs = (match) =>
  vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter((t) => t.input instanceof vscode.TabInputTextDiff && t.input.original.scheme === SCHEME && match(t.input.original));

// The file in the active tab, else the last file shown.
function current() {
  const t = vscode.window.tabGroups.activeTabGroup.activeTab;
  const i = t && t.input instanceof vscode.TabInputTextDiff ? files.findIndex((f) => f.left.toString() === t.input.original.toString()) : -1;
  return i >= 0 ? i : pos;
}

async function dismiss() {
  const i = current();
  const f = files[i];
  if (!f) return;
  await vscode.window.tabGroups.close(ourTabs((u) => u.toString() === f.left.toString()));
  files.splice(i, 1);
  await show(i); // the next file now sits at index i
}

async function dismissAll() {
  await vscode.window.tabGroups.close(ourTabs(() => true));
  files = [];
  await finish();
}

// VS Code has no per-editor inline switch, so we set the global setting
// during a review and put the old value back after.
// ponytail: two windows that review at the same time share this setting.
const cfg = () => vscode.workspace.getConfiguration('diffEditor');

async function start() {
  await vscode.commands.executeCommand('setContext', 'agentDiff.active', true);
  if (!ctx.globalState.get('saved')) {
    await ctx.globalState.update('saved', { v: cfg().inspect('renderSideBySide')?.globalValue ?? null });
  }
  await cfg().update('renderSideBySide', false, vscode.ConfigurationTarget.Global);
}

// Restores the setting first: on window close, commands fail ("Channel has been closed").
// The saved value is cleared only after the restore works, so the next start retries it.
async function finish() {
  const saved = ctx.globalState.get('saved');
  if (saved) {
    await cfg().update('renderSideBySide', saved.v ?? undefined, vscode.ConfigurationTarget.Global);
    await ctx.globalState.update('saved', undefined);
  }
  await Promise.resolve(vscode.commands.executeCommand('setContext', 'agentDiff.active', false)).catch(() => {});
}

// Status bar buttons for agent diff tabs. Each tooltip shows the key from package.json.
const BUTTONS = [
  ['workbench.action.compareEditor.previousChange', '$(arrow-up)', 'Previous Change'],
  ['workbench.action.compareEditor.nextChange', '$(arrow-down)', 'Next Change'],
  ['agentDiff.prev', '$(arrow-left)', 'Previous Changed File'],
  ['agentDiff.next', '$(arrow-right)', 'Next Changed File'],
  ['agentDiff.dismiss', '$(check)', 'Dismiss This File'],
  ['agentDiff.dismissAll', '$(check-all)', 'Dismiss All Files'],
];
let bar = [];

// "cmd+alt+left" -> "⌥⌘←" on macOS, "ctrl+alt+left" -> "Ctrl+Alt+Left" elsewhere, in the VS Code modifier order.
const MODS = ['ctrl', 'shift', 'alt', 'cmd'];
const MAC = { ctrl: '⌃', shift: '⇧', alt: '⌥', cmd: '⌘', up: '↑', down: '↓', left: '←', right: '→', backspace: '⌫' };
function keyLabel(kb) {
  const mac = process.platform === 'darwin';
  const rank = (p) => (MODS.includes(p) ? MODS.indexOf(p) : MODS.length);
  const parts = ((mac && kb.mac) || kb.key).split('+').sort((a, b) => rank(a) - rank(b));
  return mac ? parts.map((p) => MAC[p] ?? p.toUpperCase()).join('') : parts.map((p) => p[0].toUpperCase() + p.slice(1)).join('+');
}

// agentDiff.inTab limits the keys and buttons to agent diff tabs, so other diffs keep the VS Code keys.
function syncTab() {
  const t = vscode.window.tabGroups.activeTabGroup.activeTab;
  const ours = !!t && t.input instanceof vscode.TabInputTextDiff && t.input.original.scheme === SCHEME;
  Promise.resolve(vscode.commands.executeCommand('setContext', 'agentDiff.inTab', ours)).catch(() => {});
  for (const b of bar) ours ? b.show() : b.hide();
}

function activate(context) {
  ctx = context;
  const keys = context.extension.packageJSON.contributes.keybindings;
  bar = BUTTONS.map(([command, text, title], i) => {
    // Left side: a higher priority sits further left, so the buttons keep the list order.
    const b = vscode.window.createStatusBarItem(`agentDiff.bar.${i}`, vscode.StatusBarAlignment.Left, 1000 - i);
    const kb = keys.find((k) => k.command === command);
    Object.assign(b, { command, text, name: `Agent Diff: ${title}`, tooltip: kb ? `${title} (${keyLabel(kb)})` : title });
    return b;
  });
  context.subscriptions.push(...bar);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, { provideTextDocumentContent: oldContent }),
    vscode.commands.registerCommand('agentDiff.next', () => show(current() + 1)),
    vscode.commands.registerCommand('agentDiff.prev', () => show(current() - 1)),
    vscode.commands.registerCommand('agentDiff.dismiss', dismiss),
    vscode.commands.registerCommand('agentDiff.dismissAll', dismissAll),
    vscode.window.tabGroups.onDidChangeTabs(syncTab),
    vscode.window.tabGroups.onDidChangeTabGroups(syncTab),
  );
  finish(); // put the setting back if VS Code quit during a review
  for (const f of vscode.workspace.workspaceFolders ?? []) watch(f.uri.fsPath);
}

module.exports = { activate, deactivate: () => finish() };
