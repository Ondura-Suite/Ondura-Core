#!/bin/sh
# Removes the update helper only when Ondura is uninstalled, not on upgrade
# (deb: "remove"/"purge", rpm: 0).
case "$1" in
  remove|purge|0)
    if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
      systemctl disable --now ondura-update.path >/dev/null 2>&1 || true
    fi
    rm -rf /var/lib/ondura/updates /var/lib/ondura/staging
    ;;
esac
exit 0
