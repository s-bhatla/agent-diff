#!/bin/sh
# Checks that agent-diff finds every change and leaves the repo state alone.
set -eu
bin="$(cd "$(dirname "$0")" && pwd)/bin/agent-diff"
fail() { echo "FAIL: $*" >&2; exit 1; }

r=$(mktemp -d)
trap 'rm -rf "$r"' EXIT
cd "$r"
git init -q
echo '*.log' >.gitignore
echo a >keep
echo b >gone
git add -A
git -c user.name=t -c user.email=t@t commit -qm init
echo s >staged && git add staged # staged, not committed
echo u >untracked                # untracked before the run

state() { git rev-parse HEAD; git for-each-ref; git stash list; git diff --cached --name-only; }
before=$(state)

[ -z "$("$bin" snapshot)" ] || fail "snapshot printed to stdout"
echo changed >keep
rm gone
echo new >added
echo x >ignored.log
"$bin" done

set -- $(cat .git/agent-diff/review)
got=$(git diff --no-renames --name-status "$1" "$2" | tr '\t\n' ': ')
[ "$got" = "A:added D:gone M:keep " ] || fail "changed files: $got"
[ "$(state)" = "$before" ] || fail "repo state changed"
git status --porcelain | grep -q agent-diff && fail "status shows agent-diff files"

rm .git/agent-diff/review
"$bin" snapshot && "$bin" done
[ ! -e .git/agent-diff/review ] || fail "review written with no changes"

"$bin" snapshot /tmp || fail "non-repo dir should exit 0"
echo PASS
