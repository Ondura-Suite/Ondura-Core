#!/usr/bin/env python3
"""Generate THIRD-PARTY-NOTICES.txt for the Ondura binaries.

Collects the license texts of every Rust crate (normal dependencies of the
workspace, all platforms) and every npm package bundled into the frontend
(`dependencies` of apps/ondura and their dependencies). Identical texts are
printed once with the list of packages they apply to.

Usage: python3 scripts/third-party-notices.py [output]
Needs `cargo` and an installed apps/ondura/node_modules (npm ci).
"""

import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "THIRD-PARTY-NOTICES.txt")
LICENSE_FILE = re.compile(r"^(licen[cs]e|copying|notice|unlicense)([-._].*)?$", re.I)
# Fallback texts for packages that ship no license file.
SPDX_DIR = "/usr/share/common-licenses"
GENERIC = {
    "MIT": """Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.""",
}


def license_files(directory):
    try:
        names = sorted(os.listdir(directory))
    except OSError:
        return []
    texts = []
    for name in names:
        path = os.path.join(directory, name)
        if LICENSE_FILE.match(name) and os.path.isfile(path):
            with open(path, encoding="utf-8", errors="replace") as f:
                texts.append(f.read().strip())
    return texts


def fallback(spdx, authors):
    """Standard text for packages without a license file."""
    parts = []
    for ident in re.findall(r"[A-Za-z0-9.\-]+", spdx or ""):
        if ident in ("OR", "AND", "WITH"):
            continue
        if ident in GENERIC:
            parts.append(GENERIC[ident])
        elif os.path.isfile(os.path.join(SPDX_DIR, ident)):
            with open(os.path.join(SPDX_DIR, ident), encoding="utf-8") as f:
                parts.append(f.read().strip())
        else:
            continue
        break  # one text of a choice ("MIT OR Apache-2.0") is enough
    head = f"Copyright (c) {', '.join(authors)}" if authors else ""
    return "\n\n".join(p for p in [head, f"License: {spdx}", *parts] if p)


def cargo_packages():
    meta = json.loads(subprocess.check_output(["cargo", "metadata", "--format-version", "1", "--locked"], cwd=ROOT))
    packages = {p["id"]: p for p in meta["packages"]}
    nodes = {n["id"]: n for n in meta["resolve"]["nodes"]}
    todo = list(meta["workspace_members"])
    seen = set()
    while todo:
        pid = todo.pop()
        if pid in seen:
            continue
        seen.add(pid)
        for dep in nodes[pid]["deps"]:
            # Normal dependencies only: build and dev dependencies are not shipped.
            if any(k["kind"] is None for k in dep["dep_kinds"]):
                todo.append(dep["pkg"])
    for pid in sorted(seen, key=lambda i: (packages[i]["name"], packages[i]["version"])):
        p = packages[pid]
        if p["source"] is None:  # workspace crates
            continue
        directory = os.path.dirname(p["manifest_path"])
        texts = license_files(directory) or [fallback(p["license"], p["authors"])]
        yield f'{p["name"]} {p["version"]} ({p["license"]})', texts


def npm_packages():
    app = os.path.join(ROOT, "apps", "ondura")
    with open(os.path.join(app, "package.json"), encoding="utf-8") as f:
        roots = list(json.load(f).get("dependencies", {}))
    seen = {}

    def find(name, base):
        """Node's lookup: <dir>/node_modules/<name>, then the parent folders."""
        directory = base
        while directory.startswith(app):
            candidate = os.path.join(directory, "node_modules", name)
            if os.path.isfile(os.path.join(candidate, "package.json")):
                return candidate
            directory = os.path.dirname(directory)
        return None

    def walk(name, base):
        directory = find(name, base)
        if not directory or directory in seen:
            return
        with open(os.path.join(directory, "package.json"), encoding="utf-8") as f:
            pkg = json.load(f)
        seen[directory] = pkg
        for dep in pkg.get("dependencies") or {}:
            walk(dep, directory)

    for name in roots:
        walk(name, app)
    for directory, pkg in sorted(seen.items(), key=lambda kv: (kv[1]["name"], kv[1].get("version", ""))):
        spdx = pkg.get("license") or "see package"
        if isinstance(spdx, dict):
            spdx = spdx.get("type", "")
        author = pkg.get("author")
        if isinstance(author, dict):
            author = author.get("name")
        texts = license_files(directory) or [fallback(spdx, [author] if author else [])]
        yield f'{pkg["name"]} {pkg.get("version", "")} ({spdx})', texts


def main():
    groups = {}  # normalized text -> (text, [packages])
    count = 0
    for source in (cargo_packages(), npm_packages()):
        for label, texts in source:
            count += 1
            for text in texts:
                key = re.sub(r"\s+", " ", text)
                groups.setdefault(key, (text, []))[1].append(label)
    lines = [
        "Ondura – third-party notices",
        "",
        "Ondura includes the following third-party software. Each package is",
        "distributed under the license printed below its name. This file is",
        "generated by scripts/third-party-notices.py.",
        f"Packages: {count}",
        "",
    ]
    for text, labels in sorted(groups.values(), key=lambda g: g[1][0].lower()):
        lines.append("=" * 78)
        lines.extend(sorted(set(labels), key=str.lower))
        lines.append("-" * 78)
        lines.append(text)
        lines.append("")
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    print(f"{OUT}: {count} packages, {len(groups)} license texts")


if __name__ == "__main__":
    main()
