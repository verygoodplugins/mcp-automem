"""CLI diagnostics for the AutoMem Hermes memory provider."""

from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict

from hermes_constants import get_hermes_home


DEFAULT_ENDPOINT = "http://127.0.0.1:8001"
DEFAULT_TIMEOUT = 8.0


def _truthy(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _endpoint() -> str:
    return (
        os.environ.get("AUTOMEM_API_URL")
        or os.environ.get("AUTOMEM_ENDPOINT")
        or DEFAULT_ENDPOINT
    ).rstrip("/")


def _api_key() -> str:
    return os.environ.get("AUTOMEM_API_KEY") or os.environ.get("AUTOMEM_API_TOKEN") or ""


def _provider_tools_enabled() -> bool:
    value = os.environ.get("AUTOMEM_HERMES_PROVIDER_TOOLS", "true")
    return value.strip().lower() not in {"0", "false", "no", "n", "off"}


def _active_provider() -> str:
    try:
        from hermes_cli.config import cfg_get, load_config

        return str(cfg_get(load_config(), "memory", "provider", default="") or "")
    except Exception:
        return ""


def _request(method: str, path: str) -> Dict[str, Any]:
    headers = {"Content-Type": "application/json"}
    key = _api_key()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    request = urllib.request.Request(
        f"{_endpoint()}/{path.lstrip('/')}",
        method=method,
        headers=headers,
    )
    with urllib.request.urlopen(request, timeout=DEFAULT_TIMEOUT) as response:
        raw = response.read().decode("utf-8")
    return json.loads(raw) if raw else {}


def _recall_has_results(payload: Dict[str, Any]) -> bool:
    results = payload.get("results")
    if isinstance(results, list):
        return len(results) > 0
    memories = payload.get("memories")
    if isinstance(memories, list):
        return len(memories) > 0
    return False


def cmd_status(args) -> int:
    home = Path(get_hermes_home())
    active = _active_provider()
    print("\nAutoMem Hermes provider")
    print(f"  Hermes home:       {home}")
    print(f"  memory.provider:   {active or '(none)'}")
    print(f"  plugin directory:  {home / 'plugins' / 'automem'}")
    print(f"  endpoint:          {_endpoint()}")
    print(f"  API key:           {'set' if _api_key() else 'not set'}")
    print(f"  provider tools:    {'enabled' if _provider_tools_enabled() else 'disabled'}")
    print(
        "  auto capture:      "
        f"{'enabled' if _truthy(os.environ.get('AUTOMEM_HERMES_AUTO_CAPTURE', '')) else 'disabled'}"
    )
    print(f"  debug logging:     {'enabled' if _truthy(os.environ.get('AUTOMEM_HERMES_DEBUG', '')) else 'disabled'}")
    print()
    if active != "automem":
        print("  AutoMem is installed but not the active memory provider.")
        print("  Run: hermes config set memory.provider automem")
        print()
        return 1
    return 0


def cmd_doctor(args) -> int:
    status_code = cmd_status(args)
    print("AutoMem diagnostics")
    ok = status_code == 0

    try:
        health = _request("GET", "health")
        state = health.get("status") or health.get("message") or "ok"
        print(f"  health:            ok ({state})")
    except Exception as exc:
        ok = False
        print(f"  health:            failed ({type(exc).__name__}: {exc})")

    try:
        query = urllib.parse.urlencode(
            {"query": "automem hermes diagnostic recall", "limit": 1, "format": "detailed"}
        )
        recall = _request("GET", f"recall?{query}")
        print(f"  recall prefetch:   {'ok' if _recall_has_results(recall) else 'no results'}")
    except Exception as exc:
        ok = False
        print(f"  recall prefetch:   failed ({type(exc).__name__}: {exc})")

    print()
    print("Recall context is injected into the model payload before turns; Hermes does not print it in the terminal UI by default.")
    print("If recall is missing in a session, rerun with AUTOMEM_HERMES_DEBUG=true and inspect Hermes logs.")
    print()
    return 0 if ok else 1


def _load_provider():
    """Return an AutoMem provider instance.

    Prefer Hermes' own loader so we exercise the exact provider ambient recall
    uses; fall back to importing the class from this package if the loader is
    unavailable (e.g. running the module outside a full Hermes install).
    """
    try:
        from plugins.memory import load_memory_provider

        provider = load_memory_provider("automem")
        if provider is not None:
            return provider
    except Exception:
        pass
    try:
        from . import AutoMemMemoryProvider

        return AutoMemMemoryProvider()
    except Exception as exc:  # pragma: no cover - defensive
        raise SystemExit(
            f"Could not load the AutoMem provider: {type(exc).__name__}: {exc}"
        )


def _fence(raw_context: str) -> str:
    """Wrap recall output in the exact <memory-context> block Hermes injects.

    Imports Hermes' own wrapper so the rendered block byte-matches what ambient
    recall sends to the model. If the wrapper cannot be imported we fail loudly
    rather than emit a block that diverges from the real one — the whole point
    of this command is to show the *real* injected context.
    """
    try:
        from agent.memory_manager import build_memory_context_block
    except Exception as exc:
        raise SystemExit(
            "Could not import Hermes' build_memory_context_block "
            f"({type(exc).__name__}: {exc}); cannot render the real injected "
            "block. Run inside a Hermes environment, or pass --raw."
        )
    return build_memory_context_block(raw_context)


def cmd_debug_recall(args) -> int:
    prompt = (getattr(args, "prompt", "") or "").strip()
    if not prompt:
        print('A prompt is required: hermes automem debug-recall "<prompt>"', file=sys.stderr)
        return 2

    session_id = getattr(args, "session_id", None) or "debug-recall"
    provider = _load_provider()
    try:
        try:
            provider.initialize(session_id, agent_context="primary")
        except Exception as exc:
            print(f"Provider initialization failed: {type(exc).__name__}: {exc}", file=sys.stderr)
            return 1

        try:
            raw_context = provider.prefetch(prompt, session_id=session_id)
        except Exception as exc:
            print(f"Recall failed: {type(exc).__name__}: {exc}", file=sys.stderr)
            return 1

        if not raw_context or not raw_context.strip():
            print(
                "No recall context returned. Recall may be disabled "
                "(AUTOMEM_HERMES_DISABLE_RECALL), the prompt may be non-substantive, "
                "or the dataset may be empty.",
                file=sys.stderr,
            )
            return 1

        if getattr(args, "raw", False):
            print(raw_context)
        else:
            print(_fence(raw_context))
        return 0
    finally:
        # Tear down the provider's background sync thread so the CLI exits
        # promptly instead of lingering on a daemon thread.
        shutdown = getattr(provider, "shutdown", None)
        if callable(shutdown):
            try:
                shutdown()
            except Exception:
                pass


def automem_command(args) -> None:
    command = getattr(args, "automem_command", None) or "status"
    if command == "status":
        code = cmd_status(args)
    elif command == "doctor":
        code = cmd_doctor(args)
    elif command == "debug-recall":
        code = cmd_debug_recall(args)
    else:
        print(f"Unknown AutoMem command: {command}", file=sys.stderr)
        code = 2
    if code:
        raise SystemExit(code)


def register_cli(subparser) -> None:
    subs = subparser.add_subparsers(dest="automem_command")
    subs.add_parser("status", help="Show AutoMem provider configuration")
    subs.add_parser("doctor", help="Check AutoMem provider health and recall prefetch")
    debug = subs.add_parser(
        "debug-recall",
        help="Print the <memory-context> block AutoMem injects for a prompt",
        description=(
            "Run the provider's real prefetch() for PROMPT and print the exact "
            "<memory-context> block that ambient recall injects before each turn "
            "(normally invisible in the terminal). Use --raw for the unfenced text."
        ),
    )
    debug.add_argument("prompt", help="Prompt to run recall against")
    debug.add_argument(
        "--raw",
        action="store_true",
        help="Print the unfenced recall text instead of the <memory-context> block",
    )
    debug.add_argument(
        "--session-id",
        dest="session_id",
        default="debug-recall",
        help="Session id used for recall state (default: debug-recall)",
    )
    subparser.set_defaults(func=automem_command)
