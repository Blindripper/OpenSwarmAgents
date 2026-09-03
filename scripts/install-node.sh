#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${OSA_REPO_URL:-https://github.com/Blindripper/OpenSwarmAgents.git}"
INSTALL_DIR="${OSA_INSTALL_DIR:-$HOME/.local/share/openswarmagents}"
RUN_AFTER_INSTALL=0
INSTALL_SYSTEMD=-1  # -1 = auto-detect, 0 = no, 1 = yes

usage() {
  cat <<'USAGE'
OpenSwarmAgents local node installer

Usage:
  install-node.sh [--dir PATH] [--run] [--systemd] [--no-systemd]

Options:
  --dir PATH   Install or update OSA in PATH.
  --run        Start the local node after installing.
  --systemd    Install as a systemd service (auto-detected by default).
  --no-systemd Skip systemd service setup.
  --help       Show this help.

Environment:
  OSA_INSTALL_DIR       Default install directory.
  OSA_REPO_URL          Git repository URL.
  OSA_SYSTEMD_USER      System user for the service (default: $USER).
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --dir" >&2
        exit 2
      fi
      INSTALL_DIR="$2"
      shift 2
      ;;
    --run)
      RUN_AFTER_INSTALL=1
      shift
      ;;
    --systemd)
      INSTALL_SYSTEMD=1
      shift
      ;;
    --no-systemd)
      INSTALL_SYSTEMD=0
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command git
require_command node
require_command npm

node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "$node_major" -lt 22 ]; then
  echo "OpenSwarmAgents requires Node.js 22 or newer. Found: $(node --version)" >&2
  exit 1
fi

if [ -d "$INSTALL_DIR/.git" ]; then
  echo "Updating OpenSwarmAgents in $INSTALL_DIR"
  git -C "$INSTALL_DIR" pull --ff-only
elif [ -e "$INSTALL_DIR" ]; then
  echo "$INSTALL_DIR exists but is not a Git checkout." >&2
  exit 1
else
  echo "Installing OpenSwarmAgents into $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
npm ci
npm run build:agent-gui

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  chmod 600 .env
fi

# ---- Systemd service setup ----
if [ "$INSTALL_SYSTEMD" -eq -1 ]; then
  # Auto-detect: available and running
  if command -v systemctl >/dev/null 2>&1 && systemctl is-system-running >/dev/null 2>&1; then
    INSTALL_SYSTEMD=1
  else
    INSTALL_SYSTEMD=0
  fi
fi

if [ "$INSTALL_SYSTEMD" -eq 1 ]; then
  OSA_SERVICE_USER="${OSA_SYSTEMD_USER:-$USER}"
  SERVICE_FILE="/etc/systemd/system/osa-dashboard.service"

  echo "Installing systemd service as ${SERVICE_FILE} (user=${OSA_SERVICE_USER})..."

  sudo tee "$SERVICE_FILE" > /dev/null << SYSTEMDEOF
[Unit]
Description=OpenSwarmAgents (OSA) Dashboard Node
Documentation=https://github.com/Blindripper/OpenSwarmAgents
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${OSA_SERVICE_USER}
Group=${OSA_SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=$(command -v node) apps/server/src/server.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=read-only
ProtectSystem=strict
ReadWritePaths=${INSTALL_DIR}/data
UMask=0077

[Install]
WantedBy=multi-user.target
SYSTEMDEOF

  sudo systemctl daemon-reload
  sudo systemctl enable osa-dashboard.service
  sudo systemctl restart osa-dashboard.service 2>/dev/null || sudo systemctl start osa-dashboard.service

  echo "  ✓ systemd service 'osa-dashboard' is active and enabled on boot."

  # Verify reachability
  sleep 2
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8789/osa-network/ | grep -q 200; then
    echo "  ✓ Dashboard responds at http://127.0.0.1:8789/osa-network/"
  else
    echo "  ⚠ Service started but dashboard not yet responding. Check: sudo journalctl -u osa-dashboard -n 50"
  fi
fi

cat <<EOF

OpenSwarmAgents is ready.

Directory:
  $INSTALL_DIR

Start your local node:
  cd "$INSTALL_DIR"
  npm run dev

Open:
  http://127.0.0.1:8789

EOF

if [ "$RUN_AFTER_INSTALL" -eq 1 ]; then
  exec npm run dev
fi