#!/usr/bin/env bash
# Prepare a release: set the version everywhere, commit and tag.
#   scripts/release.sh 0.2.0
# Then `git push origin main v0.2.0` – CI builds, signs and publishes the
# GitHub release that Ondura's updater picks up.
set -euo pipefail
version="${1:?usage: scripts/release.sh X.Y.Z}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "version must be X.Y.Z"; exit 1; }
cd "$(dirname "$0")/.."
git diff --quiet || { echo "working tree not clean"; exit 1; }

# Workspace version (all crates inherit it).
sed -i -E "0,/^version = \"[^\"]+\"/s//version = \"$version\"/" Cargo.toml
for f in apps/ondura/src-tauri/tauri.conf.json apps/setup/src-tauri/tauri.conf.json apps/ondura/package.json; do
  [ -f "$f" ] && sed -i -E "0,/\"version\": \"[^\"]+\"/s//\"version\": \"$version\"/" "$f"
done
(cd apps/ondura && npm install --package-lock-only --ignore-scripts >/dev/null)
cargo update --workspace >/dev/null 2>&1 || cargo metadata --format-version 1 >/dev/null

git commit -am "Release $version"
git tag -a "v$version" -m "Ondura $version"
echo "Tagged v$version. Push with: git push origin main v$version"
