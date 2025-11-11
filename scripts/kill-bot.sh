#!/bin/bash
# Script to kill all bot instances

echo "🔍 Searching for bot processes..."
PIDS=$(ps aux | grep -E "node.*bot\.js|nodemon.*bot\.js" | grep -v grep | awk '{print $2}')

if [ -z "$PIDS" ]; then
    echo "✅ No bot processes found"
    exit 0
fi

echo "Found processes:"
ps aux | grep -E "node.*bot\.js|nodemon.*bot\.js" | grep -v grep

echo ""
echo "🛑 Killing processes: $PIDS"
kill -9 $PIDS 2>/dev/null

sleep 1

echo "✅ All bot processes killed"
echo ""
echo "You can now start the bot with: npm start"

