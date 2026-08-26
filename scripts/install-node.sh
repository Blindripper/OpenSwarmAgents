#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${OSA_REPO_URL:-https://github.com/Blindripper/OpenSwarmAgents.git}"
INSTALL_DIR="${OSA_INSTALL_DIR:-$HOME/.local/share/openswarmagents}"
RUN_AFTER_INSTALL=0

usage() {
  cat <<'USAGE'
OpenSwarmAgents local node installer

Usage:
  install-node.sh [--dir PATH] [--run]

Options:
  --dir PATH  Install or update OSA in PATH.
  --run       Start the local node after installing.
  --help      Show this help.

Environment:
  OSA_INSTALL_DIR  Default install directory.
  OSA_REPO_URL     Git repository URL.
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

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  chmod 600 .env
fi

cat <<EOF

OpenSwarmAgents is ready.

Directory:
  $INSTALL_DIR

Start your local node:
  cd "$INSTALL_DIR"
  npm run dev

Open:
  http://127.0.0.1:8788

EOF

if [ "$RUN_AFTER_INSTALL" -eq 1 ]; then
  exec npm run dev
fi
