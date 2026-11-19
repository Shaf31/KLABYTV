#!/bin/bash
# KLABYTV web version (Mac): double-click to start, then use it at http://localhost:8080
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "KLABYTV web needs Node.js (LTS): https://nodejs.org"
  read -r -p "Press Enter to close" _
  exit 1
fi
(sleep 1 && open "http://localhost:8080") &
node src/web/server.js "$@"
