#!/bin/sh
set -eu
if [ "$(id -u)" -ne 0 ]; then echo "Run as root" >&2; exit 1; fi
systemctl disable --now cra-agent.service 2>/dev/null || true
rm -f /etc/systemd/system/cra-agent.service
systemctl daemon-reload
rm -f /opt/cra-agent/current
echo "Service removed. /var/lib/cra-agent, /etc/cra-agent, and /opt/cra-agent/releases remain for recovery and evidence retention."
