#!/bin/bash
set -e

echo "Pulling latest code..."
if git pull --rebase origin master; then
    echo "Git pull OK"
else
    echo "Git pull failed, forcing hard reset..."
    git fetch origin
    git reset --hard origin/master
fi

echo "Building m3u-player image..."
docker build -t m3u-player .

echo "Stopping old container..."
docker stop m3u-player 2>/dev/null || true
docker rm m3u-player 2>/dev/null || true

echo "Starting new container..."
docker run -d \
  --name m3u-player \
  --restart unless-stopped \
  -e BASE_PATH=/m3u-player \
  -p 127.0.0.1:3010:3010 \
  m3u-player

echo "Done! Container running on port 3010"
