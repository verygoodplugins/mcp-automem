#!/bin/bash

# Shared Python interpreter resolution for Claude Code hooks.
# Supports POSIX-shell environments on Windows (Git Bash/MSYS2/WSL) without
# requiring the executable to be named exactly `python3`.

AUTOMEM_PYTHON_CMD=()
AUTOMEM_PYTHON_LABEL=""

automem_resolve_python() {
    if [ "${#AUTOMEM_PYTHON_CMD[@]}" -gt 0 ]; then
        return 0
    fi

    if command -v python3 >/dev/null 2>&1; then
        AUTOMEM_PYTHON_CMD=(python3)
        AUTOMEM_PYTHON_LABEL="python3"
        return 0
    fi

    if command -v python >/dev/null 2>&1; then
        AUTOMEM_PYTHON_CMD=(python)
        AUTOMEM_PYTHON_LABEL="python"
        return 0
    fi

    if command -v py >/dev/null 2>&1; then
        AUTOMEM_PYTHON_CMD=(py -3)
        AUTOMEM_PYTHON_LABEL="py -3"
        return 0
    fi

    return 1
}

automem_python_label() {
    automem_resolve_python || return 1
    printf '%s\n' "$AUTOMEM_PYTHON_LABEL"
}

automem_run_python() {
    automem_resolve_python || return 1
    "${AUTOMEM_PYTHON_CMD[@]}" "$@"
}
