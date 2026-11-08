#!/usr/bin/env bash
# Run on your own computer, in this repository: copies the current main branch to the server and
# installs the sign-in there. You'll be asked for your sudo password on the server.
#
#   bash signin/deploy/ship.sh you@185.44.254.36 rule29.co.uk
set -euo pipefail
TARGET=${1:?Give the server login, e.g. you@185.44.254.36}
DOMAIN=${2:?Give the parent domain the apps share, e.g. rule29.co.uk}
cd "$(dirname "$0")/../.."
git fetch -q origin main
SHA=$(git rev-parse --short=12 origin/main)
echo "Sending release $SHA to $TARGET"
dir="signin-release-$SHA"
# Only what is committed on main goes: no settings files, local data or node_modules.
git archive --format=tar --prefix="$dir/" origin/main \
  | ssh "$TARGET" "rm -rf '$dir' && tar -x && echo '$SHA' > '$dir/RELEASE'"
ssh -t "$TARGET" "sudo bash '$dir/signin/deploy/install.sh' '$DOMAIN' && rm -rf '$dir'"
