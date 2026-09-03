#!/usr/bin/env bash
# Install the osa-dashboard systemd service manually.
# Usage:
#   sudo bash scripts/install-systemd-service.sh [--user USER] [--dir PATH]
#
# The script auto-detects the install directory if --dir is omitted by
# checking the parent of this script (i.e., <repo>/scripts/install-systemd-service.sh).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OSA_USER="${OSA_SYSTEMD_USER:-${SUDO_USER:-$USER}}"
OSA_DIR="${OSA_INSTALL_DIR:-$REPO_DIR}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --user) OSA_USER="$2"; shift 2 ;;
    --dir)  OSA_DIR="$2";  shift 2 ;;
    --help|-h)
      echo "Install osa-dashboard systemd service"
      echo "  --user USER  System user (default: $OSA_USER)"
      echo "  --dir  PATH  Install directory (default: $OSA_DIR)"
      exit 0
      ;;
    *) echo "Unknown: $1"; exit 2 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "This script must be run as root (sudo)." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node not found in PATH" >&2
  exit 1
fi

NODE_BIN="$(command -v node)"

SERVICE_FILE="/etc/systemd/system/osa-dashboard.service"

echo "Installing systemd service:"
echo "  Service: $SERVICE_FILE"
echo "  User:    $OSA_USER"
echo "  Dir:     $OSA_DIR"
echo "  Node:    $NODE_BIN"
echo ""

cat > "$SERVICE_FILE" << SERVICE
[Unit]
Description=OpenSwarmAgents (OSA) Dashboard Node
Documentation=https://github.com/Blindripper/OpenSwarmAgents
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${OSA_USER}
Group=${OSA_USER}
WorkingDirectory=${OSA_DIR}
ExecStart=${NODE_BIN} apps/server/src/server.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=read-only
ProtectSystem=strict
ReadWritePaths=${OSA_DIR}/data
UMask=0077

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable osa-dashboard.service
systemctl restart osa-dashboard.service 2>/dev/null || systemctl start osa-dashboard.service

sleep 2
if systemctl is-active --quiet osa-dashboard.service; then
  echo "✓ Service 'osa-dashboard' is active."
  curl -s -o /dev/null -w "  → HTTP %{http_code} at http://127.0.0.1:8789/osa-network/\n" \
    http://127.0.0.1:8789/osa-network/
else
  echo "⚠ Service failed to start. Check: sudo journalctl -u osa-dashboard -n 50"
  exit 1
fi