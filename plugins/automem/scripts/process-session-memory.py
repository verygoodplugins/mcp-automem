#!/usr/bin/env python3
"""
AutoMem session memory processor wrapper.
Delegates to the canonical script in templates/claude-code/scripts.
"""
from __future__ import annotations

import runpy
import sys
from pathlib import Path
from typing import Optional


def resolve_processor() -> Optional[Path]:
    here = Path(__file__).resolve()
    if len(here.parents) >= 4:
        candidate = here.parents[3] / "templates" / "claude-code" / "scripts" / "process-session-memory.py"
        if candidate.exists():
            return candidate
    fallback = Path.home() / ".claude" / "scripts" / "process-session-memory.py"
    if fallback.exists():
        return fallback
    return None


def main() -> None:
    processor = resolve_processor()
    if processor is None:
        sys.stderr.write("process-session-memory.py not found.\n")
        sys.exit(1)

    runpy.run_path(str(processor), run_name="__main__")


if __name__ == "__main__":
    main()
