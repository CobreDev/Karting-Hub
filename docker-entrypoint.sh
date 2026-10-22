#!/bin/sh
# Starts as root so platform hooks that need it (e.g. Unraid's Tailscale integration) can run first,
# then makes the data folder ours and runs the app as PUID:PGID (default 99:100, Unraid's nobody:users).
set -e

PUID="${PUID:-99}"
PGID="${PGID:-100}"
DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  # Only touch files that aren't already ours, so restarts stay fast on big photo folders.
  find "$DATA_DIR" \( ! -user "$PUID" -o ! -group "$PGID" \) -exec chown "$PUID:$PGID" {} + 2>/dev/null || \
    echo "warning: could not change ownership of $DATA_DIR to $PUID:$PGID" >&2
  exec su-exec "$PUID:$PGID" "$@"
fi

# Already running as a non-root user (e.g. docker run --user): just start.
exec "$@"
