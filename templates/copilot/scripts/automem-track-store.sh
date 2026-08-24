#!/bin/bash
# AutoMem postToolUse tracker for store_memory calls (Copilot CLI + VS Code).
#
# Writes a per-session sentinel so the opt-in agentStop nudge
# (automem-stop-nudge.sh) can stay quiet when a store already happened this
# session. Side-effect only: emits NO output (an empty postToolUse result
# keeps the original tool result unchanged), and always exits 0.
#
# The hook is registered with a `.*store_memory` matcher, but we also verify
# the tool name in-script so a broader/ignored matcher cannot write a false
# sentinel. Payload fields are read in both camelCase (Copilot CLI) and
# snake_case (VS Code) spellings.

SESSION_ID=""
TOOL_NAME=""
if [ ! -t 0 ]; then
  HOOK_INPUT=$(cat 2>/dev/null || true)
  SESSION_ID=$(printf '%s' "$HOOK_INPUT" | sed -n 's/.*"session_\{0,1\}[Ii]d"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1 | tr -cd 'A-Za-z0-9_-')
  TOOL_NAME=$(printf '%s' "$HOOK_INPUT" | sed -n 's/.*"tool_\{0,1\}[Nn]ame"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
fi

# Belt-and-suspenders: only record store_memory tool calls. An absent tool
# name (older payloads) is allowed through because the matcher already scoped
# the event.
case "$TOOL_NAME" in
  ""|*store_memory) : ;;
  *) exit 0 ;;
esac

if [ -n "$SESSION_ID" ]; then
  : > "${TMPDIR:-/tmp}/automem-stored-${SESSION_ID}" 2>/dev/null || true
fi
exit 0
