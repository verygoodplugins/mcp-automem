#!/bin/bash

# Queue Cleanup Script for AutoMem
# Deduplicates and archives processed memories
set -o pipefail

QUEUE_FILE="$HOME/.claude/scripts/memory-queue.jsonl"
LOG_FILE="$HOME/.claude/logs/queue-cleanup.log"

QUEUE_FILE="$QUEUE_FILE" LOG_FILE="$LOG_FILE" python3 - <<'PY'
import json
import os
import sys
import time
from pathlib import Path

queue_file = Path(os.environ.get("QUEUE_FILE", ""))
log_file = Path(os.environ.get("LOG_FILE", ""))

try:
    import fcntl  # type: ignore[attr-defined]
except ImportError:
    fcntl = None

try:
    import msvcrt  # type: ignore[import-not-found]
except ImportError:
    msvcrt = None


def lock_file(handle) -> None:
    if fcntl is not None:
        fcntl.flock(handle, fcntl.LOCK_EX)
        return
    if msvcrt is not None:
        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)


def unlock_file(handle) -> None:
    if fcntl is not None:
        fcntl.flock(handle, fcntl.LOCK_UN)
        return
    if msvcrt is not None:
        try:
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        except OSError:
            pass


def log_message(message: str) -> None:
    if not log_file:
        return
    log_file.parent.mkdir(parents=True, exist_ok=True)
    with log_file.open("a", encoding="utf-8") as handle:
        handle.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}\n")


log_message("Queue cleanup started")

if not queue_file.exists() or queue_file.stat().st_size == 0:
    log_message("Queue file empty or doesn't exist, nothing to clean")
    sys.exit(0)

with queue_file.open("r+", encoding="utf-8") as handle:
    lock_file(handle)
    try:
        handle.seek(0)
        lines = handle.readlines()
        original_count = len(lines)
        log_message(f"Original queue size: {original_count} entries")

        if original_count <= 1:
            log_message("Queue too small to deduplicate")
            sys.exit(0)

        records = []
        for line in lines:
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                log_message("Deduplication failed: invalid JSON in queue")
                sys.exit(1)
            records.append((record, line if line.endswith("\n") else f"{line}\n"))

        seen = set()
        deduped_lines = []
        for record, line in records:
            content = record.get("content") if isinstance(record, dict) else None
            if content in seen:
                continue
            seen.add(content)
            deduped_lines.append(line)

        deduped_count = len(deduped_lines)
        removed_count = original_count - deduped_count
        current_lines = lines

        timestamp = time.strftime("%Y%m%d_%H%M%S")

        if removed_count > 0:
            archive_file = queue_file.parent / f"memory-queue.{timestamp}.deduped.jsonl"
            archive_file.write_text("".join(lines), encoding="utf-8")

            handle.seek(0)
            handle.truncate()
            handle.write("".join(deduped_lines))
            handle.flush()
            os.fsync(handle.fileno())

            log_message(f"Deduplication complete: removed {removed_count} duplicates")
            log_message(f"New queue size: {deduped_count} entries")
            log_message(f"Original archived to: {archive_file}")
            log_message("Queue replaced with deduplicated version")
            current_lines = deduped_lines
        else:
            log_message("No duplicates found, original queue unchanged")

        current_count = len(current_lines)
        if current_count > 50:
            archive_file = queue_file.parent / f"memory-queue.{timestamp}.overflow.jsonl"
            archive_file.write_text("".join(current_lines), encoding="utf-8")

            trimmed = current_lines[-20:]
            handle.seek(0)
            handle.truncate()
            handle.write("".join(trimmed))
            handle.flush()
            os.fsync(handle.fileno())

            log_message(
                f"Queue overflow: archived {current_count} entries, kept last {len(trimmed)}"
            )

    finally:
        unlock_file(handle)

log_message("Queue cleanup complete")
PY
