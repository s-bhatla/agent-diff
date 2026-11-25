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
  setMode(true); // each run starts in review mode
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

// Review mode: the plain keys in package.json review the diff. Edit mode: the editor works as usual.
// Only agentDiff.toggleMode switches the mode.
let review = true;
let ours = false; // the active tab is an agent diff
let keys = []; // contributes.keybindings of package.json
let modeItem;

const isOurs = (t) => !!t && t.input instanceof vscode.TabInputTextDiff && t.input.original.scheme === SCHEME;
const activeTab = () => vscode.window.tabGroups.activeTabGroup.activeTab;

// "cmd+alt+left" -> "⌥⌘←" on macOS, "ctrl+alt+left" -> "Ctrl+Alt+Left" elsewhere, in the VS Code modifier order.
const MODS = ['ctrl', 'shift', 'alt', 'cmd'];
const MAC = { ctrl: '⌃', shift: '⇧', alt: '⌥', cmd: '⌘', up: '↑', down: '↓', left: '←', right: '→', backspace: '⌫', enter: '⏎' };
function keyLabel(kb) {
  const mac = process.platform === 'darwin';
  const rank = (p) => (MODS.includes(p) ? MODS.indexOf(p) : MODS.length);
  const parts = ((mac && kb.mac) || kb.key).split('+').sort((a, b) => rank(a) - rank(b));
  return mac ? parts.map((p) => MAC[p] ?? p.toUpperCase()).join('') : parts.map((p) => p[0].toUpperCase() + p.slice(1)).join('+');
}

// The key of a command in review mode (the bindings that need agentDiff.review) or in edit mode (the others).
// A command with no key for review mode, like the toggle, shows its other key.
function keyOf(command, rev) {
  const reviewOnly = (k) => /(^|[^!])agentDiff\.review\b/.test(k.when);
  const kb =
    keys.find((k) => k.command === command && reviewOnly(k) === rev) ?? keys.find((k) => k.command === command && !reviewOnly(k));
  return kb ? keyLabel(kb) : '';
}

const LEGEND = [
  [['workbench.action.compareEditor.previousChange', 'workbench.action.compareEditor.nextChange'], 'change'],
  [['agentDiff.prev', 'agentDiff.next'], 'file'],
  [['agentDiff.dismiss'], 'dismiss'],
  [['agentDiff.dismissAll'], 'all'],
];
const MODE_LEGEND = { true: [['agentDiff.toggleMode'], 'edit'], false: [['agentDiff.toggleMode'], 'review'] };
const RUNNABLE = new Set([...LEGEND, ...Object.values(MODE_LEGEND)].flatMap(([cmds]) => cmds));

// Toast text for the current mode. Each key is a link that runs its command.
function legend() {
  const link = (cmd) => `[${keyOf(cmd, review)}](command:agentDiff.run?${encodeURIComponent(JSON.stringify([cmd]))})`;
  const groups = [...LEGEND, MODE_LEGEND[review]].map(([cmds, word]) => `${cmds.map(link).join(' / ')} ${word}`);
  return `${review ? 'Review' : 'Edit'}: ${groups.join(' · ')}`;
}

// The toast is a progress notification that never ends: VS Code hides other info toasts after 10 s.
// Esc or "Cancel" closes it. The next mode switch or agent diff tab opens it again.
let toastId = 0;
let toastEnd;
function closeToast() {
  toastId++;
  toastEnd?.();
  toastEnd = undefined;
}
function openToast() {
  closeToast();
  const id = toastId;
  const task = (_progress, token) =>
    new Promise((done) => {
      if (id !== toastId) return done(); // replaced before VS Code started it
      toastEnd = done;
      token.onCancellationRequested(() => {
        if (id === toastId) toastEnd = undefined;
        done();
      });
    });
  const opts = { location: vscode.ProgressLocation.Notification, title: legend(), cancellable: true };
  Promise.resolve(vscode.window.withProgress(opts, task)).catch(() => {});
}

function setMode(r) {
  review = r;
  Promise.resolve(vscode.commands.executeCommand('setContext', 'agentDiff.review', r)).catch(() => {});
  modeItem.text = r ? '$(eye) Review' : '$(edit) Edit';
  modeItem.tooltip = `Agent Diff: ${r ? 'review' : 'edit'} mode. Click or press ${keyOf('agentDiff.toggleMode', false)} to switch.`;
  if (ours) openToast();
  syncNeovim();
}

// vscode-neovim sends the arrows of normal mode to Neovim before VS Code keybindings see them,
// so nvim/agent-diff.lua maps them there and reads this flag. Without vscode-neovim the command fails quietly.
function syncNeovim() {
  const lua = `vim.g.agent_diff_reviewing = ${ours && review}`;
  Promise.resolve(vscode.commands.executeCommand('vscode-neovim.lua', lua)).catch(() => {});
}

// agentDiff.inTab limits the keys and buttons to agent diff tabs, so other diffs keep the VS Code keys.
function syncTab() {
  const now = isOurs(activeTab());
  Promise.resolve(vscode.commands.executeCommand('setContext', 'agentDiff.inTab', now)).catch(() => {});
  if (now === ours) return;
  ours = now;
  syncNeovim();
  if (ours) {
    modeItem.show();
    openToast();
  } else {
    modeItem.hide();
    closeToast();
  }
}

function activate(context) {
  ctx = context;
  keys = context.extension.packageJSON.contributes.keybindings;
  modeItem = vscode.window.createStatusBarItem('agentDiff.mode', vscode.StatusBarAlignment.Left, 1000);
  Object.assign(modeItem, { name: 'Agent Diff Mode', command: 'agentDiff.toggleMode' });
  setMode(true);
  context.subscriptions.push(
    modeItem,
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, { provideTextDocumentContent: oldContent }),
    vscode.commands.registerCommand('agentDiff.next', () => show(current() + 1)),
    vscode.commands.registerCommand('agentDiff.prev', () => show(current() - 1)),
    vscode.commands.registerCommand('agentDiff.dismiss', dismiss),
    vscode.commands.registerCommand('agentDiff.dismissAll', dismissAll),
    vscode.commands.registerCommand('agentDiff.toggleMode', () => setMode(!review)),
    // Toast links: a click moves focus to the toast, so put it back for the plain keys.
    vscode.commands.registerCommand('agentDiff.run', async (cmd) => {
      if (!RUNNABLE.has(cmd)) return;
      await vscode.commands.executeCommand(cmd);
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    }),
    vscode.window.tabGroups.onDidChangeTabs(syncTab),
    vscode.window.tabGroups.onDidChangeTabGroups(syncTab),
  );
  finish(); // put the setting back if VS Code quit during a review
  for (const f of vscode.workspace.workspaceFolders ?? []) watch(f.uri.fsPath);
}

module.exports = { activate, deactivate: () => finish() };
