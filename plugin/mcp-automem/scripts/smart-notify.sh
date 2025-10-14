#!/bin/bash
# ~/.claude/scripts/smart-notify.sh
# Simple notification script for Claude Code hooks

# Read hook input data from standard input
INPUT=$(cat)

# Extract data from input
SESSION_DIR=$(basename "$(pwd)")
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path')
HOOK_EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // "Unknown"')
NOTIFICATION_MSG=$(echo "$INPUT" | jq -r '.message // empty')

# Get the latest assistant message for context (for Stop events)
if [ -f "$TRANSCRIPT_PATH" ] && [ "$HOOK_EVENT" = "Stop" ]; then
    # Extract assistant messages from the last 10 lines and get the latest one
    # Remove newlines and limit to 60 characters for notifications
    LAST_ASSISTANT_MSG=$(tail -10 "$TRANSCRIPT_PATH" | \
                        jq -r 'select(.message.role == "assistant") | .message.content[0].text' | \
                        tail -1 | \
                        tr '\n' ' ' | \
                        cut -c1-60)
else
    LAST_ASSISTANT_MSG=""
fi

# Determine notification type and message
case "$HOOK_EVENT" in
    "Notification")
        TITLE="Input Required"
        MSG=${NOTIFICATION_MSG:-"Claude needs your input"}
        SOUND="Glass"
        ;;
    "Stop")
        TITLE="Task Complete"
        MSG=${LAST_ASSISTANT_MSG:-"Task completed"}
        SOUND="Blow"
        ;;
    *)
        TITLE="Claude Code"
        MSG="Claude has an update"
        SOUND="Default"
        ;;
esac

# Send notification
if command -v terminal-notifier >/dev/null 2>&1; then
    terminal-notifier \
        -title "Claude Code ($SESSION_DIR)" \
        -subtitle "$TITLE" \
        -message "$MSG" \
        -sound "$SOUND"
else
    osascript -e "display notification \"$MSG\" with title \"Claude Code ($SESSION_DIR) - $TITLE\" sound name \"$SOUND\""
fi
