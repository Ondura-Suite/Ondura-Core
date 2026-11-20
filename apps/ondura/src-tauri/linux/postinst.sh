#!/bin/sh
# Sets up the Ondura update helper (systemd path unit + request folder).
# Users may drop requests (sticky, not listable); the helper only installs
# packages signed with the Ondura update key.
# Each app runs as its own program, all of them links to `ondura`; the
# program name decides the app (and what the system monitor shows).
for app in mail text sheets slides pdf notes planner diagram forms; do
  ln -sf ondura "/usr/bin/ondura-$app"
done
install -d -m 0755 /var/lib/ondura
install -d -m 1733 /var/lib/ondura/updates
install -d -m 0700 /var/lib/ondura/staging
if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl enable --now ondura-update.path >/dev/null 2>&1 || true
fi
exit 0
