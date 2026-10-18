#!/bin/sh
set -eu

if [ ! -r /run/secrets/app_env ]; then
  echo "Required Docker secret app_env is missing or unreadable." >&2
  exit 1
fi

cp /run/secrets/app_env /app/.dev.vars
chown app:app /app/.dev.vars
chmod 600 /app/.dev.vars

exec gosu app "$@"
