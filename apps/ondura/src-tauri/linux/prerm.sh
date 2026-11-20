#!/bin/sh
# Removes the update helper and the app links only when Ondura is
# uninstalled, not on upgrade
# (deb: "remove"/"purge", rpm: 0).
case "$1" in
  remove|purge|0)
    if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
      systemctl disable --now ondura-update.path >/dev/null 2>&1 || true
    fi
    rm -rf /var/lib/ondura/updates /var/lib/ondura/staging
    for app in mail text sheets slides pdf notes planner diagram forms; do
      [ -L "/usr/bin/ondura-$app" ] && rm -f "/usr/bin/ondura-$app"
    done
    ;;
esac
exit 0
