#!/usr/bin/env bash
# Central Invoicing System Launcher
# Craftographers & AS Enterprises

cd "$(dirname "$0")"

PORT=8080
echo "======================================================="
echo " Starting Central Invoicing System"
echo " Firms: Craftographers & AS Enterprises"
echo "======================================================="

# Open browser automatically on macOS
(sleep 1 && open "http://localhost:${PORT}") &

python3 server.py ${PORT}
