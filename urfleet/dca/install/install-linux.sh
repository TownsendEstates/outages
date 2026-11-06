#!/usr/bin/env bash
# UrFleet DCA — Linux / Raspberry Pi installer (systemd)
#
#   sudo ./install-linux.sh --endpoint https://<project>.supabase.co/functions/v1/dca-ingest \
#        --key dca_xxxxxxxx --range 192.168.1.0/24 [--community public] [--site-name "Main office"]
#
# Requires python3 (3.8+). No pip packages needed.
set -euo pipefail

ENDPOINT="" KEY="" SITE="" RANGES=() COMMS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --endpoint) ENDPOINT="$2"; shift 2 ;;
    --key) KEY="$2"; shift 2 ;;
    --range) RANGES+=("$2"); shift 2 ;;
    --community) COMMS+=("$2"); shift 2 ;;
    --site-name) SITE="$2"; shift 2 ;;
    *) echo "unknown option $1"; exit 1 ;;
  esac
done
[[ -z "$ENDPOINT" || -z "$KEY" ]] && { echo "--endpoint and --key are required"; exit 1; }
[[ $EUID -ne 0 ]] && { echo "run as root (sudo)"; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }

HERE="$(cd "$(dirname "$0")/.." && pwd)"
install -d -m 0755 /opt/urfleet-dca
install -m 0755 "$HERE/urfleet_dca.py" /opt/urfleet-dca/urfleet_dca.py
id urfleet-dca >/dev/null 2>&1 || useradd --system --home /var/lib/urfleet-dca --shell /usr/sbin/nologin urfleet-dca
install -d -o urfleet-dca -g urfleet-dca -m 0750 /var/lib/urfleet-dca

ARGS=(-c /var/lib/urfleet-dca/dca.json init --endpoint "$ENDPOINT" --key "$KEY" --site-name "$SITE")
for r in "${RANGES[@]:-}"; do [[ -n "$r" ]] && ARGS+=(--range "$r"); done
for c in "${COMMS[@]:-}"; do [[ -n "$c" ]] && ARGS+=(--community "$c"); done
sudo -u urfleet-dca HOME=/var/lib/urfleet-dca python3 /opt/urfleet-dca/urfleet_dca.py "${ARGS[@]}"
chmod 600 /var/lib/urfleet-dca/dca.json

cat > /etc/systemd/system/urfleet-dca.service <<'UNIT'
[Unit]
Description=UrFleet Data Collection Agent
After=network-online.target
Wants=network-online.target

[Service]
User=urfleet-dca
Environment=HOME=/var/lib/urfleet-dca
ExecStart=/usr/bin/python3 /opt/urfleet-dca/urfleet_dca.py -c /var/lib/urfleet-dca/dca.json run
Restart=always
RestartSec=30
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/urfleet-dca
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now urfleet-dca
echo "UrFleet DCA installed. Logs: journalctl -u urfleet-dca -f  (and /var/lib/urfleet-dca/dca.log)"
