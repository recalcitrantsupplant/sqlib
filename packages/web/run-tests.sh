#!/bin/bash

# Simple script to run Playwright tests with both servers

echo "🚀 Starting backend API on port 3000..."
cd ../../
npm run dev > /tmp/api-server.log 2>&1 &
API_PID=$!

echo "⏳ Waiting for API to start..."
sleep 5

# Check if API is running
if ! curl -s http://localhost:3000/docs > /dev/null; then
  echo "⚠️  Warning: API server may not be running on port 3000"
  echo "   Tests will still run but may fail without the API"
fi

echo "✅ Running Playwright tests..."
cd packages/web
npm run test:simple

# Cleanup
echo "🧹 Stopping backend API..."
kill $API_PID 2>/dev/null

echo "✨ Done!"
