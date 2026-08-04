#!/bin/bash
# AutoMem agentStop nudge (Copilot CLI + VS Code) - opt-in, LLM-judged.
#
# If no store_memory call happened this session (tracked by
# automem-track-store.sh via the automem-stored-<sessionId> sentinel) AND the
# transcript shows a substantive session (>= 5 user turns), emit a one-shot
# decision:block whose `reason` re-wakes the agent for one closing turn to
# consider storing durable memory. Guarded once-per-session. Advisory only:
# never errors the hook, always exits 0.
#
# NOTE on parity: Copilot's agentStop output contract is {decision, reason}
# (block re-prompts the agent using `reason`). Unlike Claude Code's Stop hook
# it cannot inject hidden, non-prompting context, so this nudge is registered
# only by the opt-in `full` profile; the default `lean` install stays silent.
# The transcript at transcriptPath is parsed best-effort - an unreadable or
# unparseable count stays silent (the safe failure), matching the Claude nudge.

SESSION_ID=""
TRANSCRIPT_PATH=""
if [ ! -t 0 ]; then
  HOOK_INPUT=$(cat 2>/dev/null || true)
  SESSION_ID=$(printf '%s' "$HOOK_INPUT" | sed -n 's/.*"session_\{0,1\}[Ii]d"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1 | tr -cd 'A-Za-z0-9_-')
  TRANSCRIPT_PATH=$(printf '%s' "$HOOK_INPUT" | sed -n 's/.*"transcript_\{0,1\}[Pp]ath"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
fi

# No session_id -> no dedup possible. Stay silent rather than risk a
# nudge -> forced turn -> agentStop -> nudge loop.
if [ -z "$SESSION_ID" ]; then
  exit 0
fi

STORED_SENTINEL="${TMPDIR:-/tmp}/automem-stored-${SESSION_ID}"
NUDGED_SENTINEL="${TMPDIR:-/tmp}/automem-stop-nudged-${SESSION_ID}"

# Stored: a store_memory call already happened -> nothing to nudge.
# Nudged: we already nudged once this session -> stay silent on re-entry.
if [ -e "$STORED_SENTINEL" ] || [ -e "$NUDGED_SENTINEL" ]; then
  exit 0
fi

# Substantive-session gate. No readable transcript or an unparseable count
# stays silent WITHOUT burning the once-per-session sentinel, so a later
# agentStop can still nudge once the conversation crosses the threshold.
if [ -z "$TRANSCRIPT_PATH" ] || [ ! -r "$TRANSCRIPT_PATH" ]; then
  exit 0
fi
USER_TURNS=$(awk '
  /^[[:space:]]*\{[[:space:]]*"type"[[:space:]]*:[[:space:]]*"user\.message"/ { count += 1 }
  END { print count + 0 }
' "$TRANSCRIPT_PATH" 2>/dev/null)
case "$USER_TURNS" in
  ''|*[!0-9]*) exit 0 ;;
esac
if [ "$USER_TURNS" -lt 5 ]; then
  exit 0
fi

# Write the sentinel before emitting so a re-entrant agentStop sees it. If it
# cannot be created, the once-per-session guarantee is gone, so stay silent
# rather than risk re-prompting on every turn.
if ! : > "$NUDGED_SENTINEL" 2>/dev/null; then
  exit 0
fi

printf '{"decision":"block","reason":%s}\n' '"AutoMem: nothing was stored this session. If anything durable emerged - a correction, a stabilized decision, an articulated pattern, or a root-cause insight - recall first, then store it with store_memory and associate it. Otherwise end the turn without storing. Do not store session summaries, progress notes, or confirmations."'

# Advisory hook: always succeed so the agent never treats agentStop as failed.
exit 0
