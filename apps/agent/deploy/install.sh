#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then echo "Run as root" >&2; exit 1; fi
if [ "$#" -ne 1 ] || [ ! -f "$1/package.json" ] || [ ! -f "$1/dist/main.js" ] || [ ! -d "$1/node_modules" ]; then echo "Usage: install.sh /path/to/built-agent-release" >&2; exit 1; fi
if [ ! -x /usr/bin/node ]; then echo "Install Node.js 20+ at /usr/bin/node for systemd" >&2; exit 1; fi
node_major="$(/usr/bin/node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 20 ]; then echo "Node.js 20 or newer is required" >&2; exit 1; fi

release="$(date +%Y%m%d%H%M%S)-$$"
install -d -m 0755 /opt/cra-agent/releases
install -d -m 0750 /etc/cra-agent
if ! id cra-agent >/dev/null 2>&1; then useradd --system --home-dir /var/lib/cra-agent --shell /usr/sbin/nologin cra-agent; fi
install -d -o cra-agent -g cra-agent -m 0700 /var/lib/cra-agent
cp -a "$1" "/opt/cra-agent/releases/$release"
chown -R root:root "/opt/cra-agent/releases/$release"
if ! /usr/bin/node -e 'const Database=require(process.argv[1]); new Database(":memory:").close()' "/opt/cra-agent/releases/$release/node_modules/better-sqlite3"; then
  echo "SQLite native module does not match this host. Rebuild the release on this Linux architecture and Node major version." >&2
  exit 1
fi
if [ ! -e /etc/cra-agent/config.json ]; then
  install -m 0640 -o root -g cra-agent "/opt/cra-agent/releases/$release/config.example.json" /etc/cra-agent/config.json
fi
install -m 0644 "/opt/cra-agent/releases/$release/deploy/cra-agent.service" /etc/systemd/system/cra-agent.service
ln -sfn "releases/$release" /opt/cra-agent/current.next
mv -Tf /opt/cra-agent/current.next /opt/cra-agent/current
systemctl daemon-reload
echo "Installed CRA agent release $release. Configure /etc/cra-agent, enroll, then systemctl enable --now cra-agent."
