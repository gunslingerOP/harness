#!/bin/sh
# Thin shim: all logic lives in guards/repo-lint.js so it is testable. stdin passes through exec.
exec node "$(dirname "$0")/../guards/repo-lint.js" "$@"
