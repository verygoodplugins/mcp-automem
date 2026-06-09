"""AutoMem memory provider for Hermes Agent.

This plugin is installed into $HERMES_HOME/plugins/automem by the AutoMem
installer. It uses Hermes' native MemoryProvider lifecycle for ambient recall
and keeps automatic turn capture disabled by default.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Set, Tuple

from agent.memory_provider import MemoryProvider
from tools.registry import tool_error


DEFAULT_ENDPOINT = "http://127.0.0.1:8001"
DEFAULT_TIMEOUT = 8.0
DEFAULT_RECALL_LIMIT = 5
PREFERENCE_RECALL_LIMIT = 5
CONTEXT_RECALL_LIMIT = 10
DEBUG_RECALL_LIMIT = 10
CONTEXT_RECALL_WINDOW_DAYS = 90
MAX_EXPLICIT_RECALL_LIMIT = 10
AMBIGUOUS_PROJECT_TAGS = {"api", "app", "test", "video"}
ENTITY_STOPWORDS = {
    "also",
    "and",
    "but",
    "can",
    "could",
    "does",
    "how",
    "should",
    "that",
    "then",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "would",
}
CASUAL_OPENING_PATTERN = re.compile(
    r"^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|great|ping|test|who are you)\b",
    re.IGNORECASE,
)
DEBUG_PROMPT_PATTERN = re.compile(
    r"(error|exception|traceback|stack trace|stacktrace|failing|fails|failed|failure|bug|regression|crash|broken|debug|investigat|not work|doesn't work|does not work|cannot|can't|fix)",
    re.IGNORECASE,
)
EXPLICIT_RECALL_PROMPT_PATTERN = re.compile(
    r"(what do (you|we) (have|know) about|what do you remember about|tell me about|who is|who's|do you remember|remember when|recall|search memory|check memory|look in memory|have we spoken about|what do you have on|do we like|how do we feel about|what do we think (of|about))",
    re.IGNORECASE,
)
ENTITY_PATTERN = re.compile(r"\b(?:[A-Z][A-Za-z0-9_-]{2,}|[a-z0-9]+(?:-[a-z0-9]+)+)\b")
logger = logging.getLogger(__name__)


def _truthy(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _debug_enabled() -> bool:
    return _truthy(os.environ.get("AUTOMEM_HERMES_DEBUG", ""))


def _debug(message: str, *args: Any) -> None:
    if _debug_enabled():
        logger.info("[automem] " + message, *args)


def _provider_tools_enabled() -> bool:
    value = os.environ.get("AUTOMEM_HERMES_PROVIDER_TOOLS", "true")
    return value.strip().lower() not in {"0", "false", "no", "n", "off"}


def _api_key() -> str:
    return os.environ.get("AUTOMEM_API_KEY") or os.environ.get("AUTOMEM_API_TOKEN") or ""


def _endpoint() -> str:
    return (
        os.environ.get("AUTOMEM_API_URL")
        or os.environ.get("AUTOMEM_ENDPOINT")
        or DEFAULT_ENDPOINT
    ).rstrip("/")


def _clean_text(value: str) -> str:
    return (value or "").strip()


def _normalize_project_tag(value: str) -> str:
    tag = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower())
    return tag.strip("-")[:64]


def _default_project_tags() -> List[str]:
    slug = _normalize_project_tag(os.path.basename(os.getcwd()))
    if not slug or slug in AMBIGUOUS_PROJECT_TAGS:
        return []
    return [slug]


def _prompt_targets_project(prompt: str, project_tag: str) -> bool:
    tag = _normalize_project_tag(project_tag)
    if not tag:
        return False
    prompt_slug = re.sub(r"[^a-z0-9]+", "-", (prompt or "").strip().lower()).strip("-")
    if not prompt_slug:
        return False
    if f"-{tag}-" in f"-{prompt_slug}-":
        return True
    tag_tokens = [token for token in tag.split("-") if token]
    prompt_tokens = {token for token in prompt_slug.split("-") if token}
    return bool(tag_tokens) and all(token in prompt_tokens for token in tag_tokens)


def _project_tags_for_task_context(prompt: str, *, is_explicit: bool) -> List[str]:
    tags = _default_project_tags()
    if tags and is_explicit and not _prompt_targets_project(prompt, tags[0]):
        return []
    return tags


def _is_substantive_prompt(prompt: str) -> bool:
    normalized = " ".join((prompt or "").split())
    if not normalized:
        return False
    words = [word for word in normalized.split(" ") if word]
    if CASUAL_OPENING_PATTERN.search(normalized) and len(words) <= 4:
        return False
    return len(words) >= 3 or "?" in normalized or bool(DEBUG_PROMPT_PATTERN.search(normalized))


def _looks_like_debug_prompt(prompt: str) -> bool:
    return bool(DEBUG_PROMPT_PATTERN.search(prompt or ""))


def _looks_like_explicit_recall_prompt(prompt: str) -> bool:
    return bool(EXPLICIT_RECALL_PROMPT_PATTERN.search(prompt or ""))


def _extract_prompt_entities(prompt: str) -> Set[str]:
    entities: Set[str] = set()
    for match in ENTITY_PATTERN.finditer(prompt or ""):
        token = match.group(0).strip("-_")
        normalized = token.lower()
        if len(token) >= 3 and normalized not in ENTITY_STOPWORDS:
            entities.add(normalized)
    return entities


def _bounded_recall_limit(value: Any) -> int:
    try:
        limit = int(value or DEFAULT_RECALL_LIMIT)
    except (TypeError, ValueError):
        return DEFAULT_RECALL_LIMIT
    return max(1, min(limit, MAX_EXPLICIT_RECALL_LIMIT))


def _format_memory_result(item: Dict[str, Any]) -> str:
    memory = item.get("memory") if isinstance(item.get("memory"), dict) else item
    content = _clean_text(str(memory.get("content") or item.get("content") or ""))
    if not content:
        return ""
    tags = memory.get("tags") or item.get("tags") or []
    tag_text = ""
    if isinstance(tags, list) and tags:
        tag_text = f" [{' '.join(str(tag) for tag in tags[:4])}]"
    return f"- {content}{tag_text}"


def _extract_recall_items(response: Any) -> List[Dict[str, Any]]:
    if isinstance(response, list):
        return [item for item in response if isinstance(item, dict)]
    if not isinstance(response, dict):
        return []
    for key in ("results", "memories", "items", "data"):
        value = response.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    memory = response.get("memory")
    if isinstance(memory, dict):
        return [memory]
    return []


def _memory_key(item: Dict[str, Any]) -> str:
    memory = item.get("memory") if isinstance(item.get("memory"), dict) else item
    memory_id = memory.get("id") or item.get("id")
    if memory_id:
        return f"id:{memory_id}"
    content = _clean_text(str(memory.get("content") or item.get("content") or ""))
    return f"content:{content[:160]}"


def _format_recall_section(
    label: str,
    response: Any,
    seen: Set[str],
    limit: int,
) -> str:
    lines: List[str] = []
    for item in _extract_recall_items(response):
        if not isinstance(item, dict):
            continue
        key = _memory_key(item)
        if key in seen:
            continue
        line = _format_memory_result(item)
        if not line:
            continue
        seen.add(key)
        lines.append(line)
        if len(lines) >= limit:
            break
    if not lines:
        return ""
    return f"{label}:\n" + "\n".join(lines)


class AutoMemClient:
    def __init__(self, endpoint: str, api_key: str, timeout: float = DEFAULT_TIMEOUT):
        self.endpoint = endpoint.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def request(self, method: str, path: str, body: Optional[Dict[str, Any]] = None) -> Any:
        url = f"{self.endpoint}/{path.lstrip('/')}"
        data = None
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if body is not None and method.upper() != "GET":
            data = json.dumps(body).encode("utf-8")
        request = urllib.request.Request(url, data=data, method=method.upper(), headers=headers)
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else {}

    def recall(self, args: Dict[str, Any]) -> Any:
        params = urllib.parse.urlencode(
            {
                key: value
                for key, value in {
                    "query": args.get("query", ""),
                    "limit": _bounded_recall_limit(args.get("limit")),
                    "format": args.get("format") or "detailed",
                    "time_query": args.get("time_query"),
                    "sort": args.get("sort"),
                }.items()
                if value not in {"", None}
            },
            doseq=True,
        )
        if isinstance(args.get("tags"), list):
            tag_params = urllib.parse.urlencode({"tags": args["tags"]}, doseq=True)
            params = f"{params}&{tag_params}" if params else tag_params
        return self.request("GET", f"recall?{params}" if params else "recall")

    def store(self, args: Dict[str, Any]) -> Any:
        return self.request("POST", "memory", args)

    def associate(self, args: Dict[str, Any]) -> Any:
        return self.request("POST", "associate", args)

    def update(self, args: Dict[str, Any]) -> Any:
        memory_id = str(args.get("memory_id") or "").strip()
        if not memory_id:
            raise ValueError("memory_id is required")
        updates = {key: value for key, value in args.items() if key != "memory_id"}
        return self.request("PATCH", f"memory/{urllib.parse.quote(memory_id)}", updates)

    def health(self) -> Any:
        return self.request("GET", "health")


class AutoMemMemoryProvider(MemoryProvider):
    def __init__(self):
        self._endpoint = DEFAULT_ENDPOINT
        self._api_key = ""
        self._client: Optional[AutoMemClient] = None
        self._active = False
        self._auto_recall = True
        self._auto_capture = False
        self._write_enabled = True
        self._sync_thread: Optional[threading.Thread] = None
        self._session_state: Dict[str, Dict[str, Any]] = {}

    @property
    def name(self) -> str:
        return "automem"

    def is_available(self) -> bool:
        return bool(_endpoint())

    def get_config_schema(self) -> List[Dict[str, Any]]:
        return [
            {
                "key": "endpoint",
                "description": "AutoMem API URL",
                "default": DEFAULT_ENDPOINT,
                "required": True,
                "env_var": "AUTOMEM_API_URL",
            },
            {
                "key": "api_key",
                "description": "AutoMem API key",
                "secret": True,
                "required": False,
                "env_var": "AUTOMEM_API_KEY",
            },
        ]

    def save_config(self, values: Dict[str, Any], hermes_home: str) -> None:
        return None

    def initialize(self, session_id: str, **kwargs) -> None:
        self._endpoint = _endpoint()
        self._api_key = _api_key()
        self._auto_recall = not _truthy(os.environ.get("AUTOMEM_HERMES_DISABLE_RECALL", ""))
        self._auto_capture = _truthy(os.environ.get("AUTOMEM_HERMES_AUTO_CAPTURE", ""))
        agent_context = kwargs.get("agent_context", "")
        self._write_enabled = agent_context not in {"cron", "flush", "subagent"}
        self._client = AutoMemClient(self._endpoint, self._api_key)
        self._active = bool(self._endpoint)
        _debug(
            "initialized provider endpoint=%s api_key_set=%s provider_tools=%s auto_capture=%s agent_context=%s",
            self._endpoint,
            bool(self._api_key),
            _provider_tools_enabled(),
            self._auto_capture,
            agent_context or "primary",
        )

    def system_prompt_block(self) -> str:
        if not self._active:
            return ""
        if not _provider_tools_enabled():
            # Both mode (AUTOMEM_HERMES_PROVIDER_TOOLS=false): the provider
            # registers no explicit tools (see get_tool_schemas), so durable
            # writes go through the AutoMem MCP server instead. Advertising the
            # disabled automem_* tools here would tell the agent to call tools
            # that aren't registered.
            return (
                "# AutoMem\n"
                "AutoMem is active as the Hermes memory provider. Ambient recall is "
                "injected before each turn; use it when relevant. Durable memory writes "
                "go through the AutoMem MCP server's mcp_automem_* tools."
            )
        return (
            "# AutoMem\n"
            "AutoMem is active as the Hermes memory provider. Use ambient recall when relevant "
            "and the automem_* tools for intentional durable memory writes."
        )

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        prompt = _clean_text(query)
        if not self._active or not self._auto_recall or not self._client or not prompt:
            return ""

        session_key = session_id or "default"
        state = self._session_state.setdefault(
            session_key,
            {"first_substantive_done": False, "entities": set()},
        )
        known_entities = state.get("entities")
        if not isinstance(known_entities, set):
            known_entities = set()
            state["entities"] = known_entities

        entities = _extract_prompt_entities(prompt)
        is_substantive = _is_substantive_prompt(prompt)
        is_debug = _looks_like_debug_prompt(prompt)
        is_explicit = _looks_like_explicit_recall_prompt(prompt)
        first_substantive = is_substantive and not state.get("first_substantive_done")
        new_entities = entities.difference(known_entities)
        topic_shift = (
            not first_substantive
            and not is_debug
            and not is_explicit
            and bool(new_entities)
        )

        recall_plan: List[Tuple[str, Dict[str, Any], int]] = []
        if first_substantive:
            recall_plan.append(
                (
                    "Preferences",
                    {
                        "tags": ["preference"],
                        "limit": PREFERENCE_RECALL_LIMIT,
                        "sort": "updated_desc",
                        "format": "detailed",
                    },
                    PREFERENCE_RECALL_LIMIT,
                )
            )
            context_args: Dict[str, Any] = {
                "query": prompt[:500],
                "time_query": f"last {CONTEXT_RECALL_WINDOW_DAYS} days",
                "limit": CONTEXT_RECALL_LIMIT,
                "format": "detailed",
            }
            project_tags = _project_tags_for_task_context(prompt, is_explicit=is_explicit)
            if project_tags:
                context_args["tags"] = project_tags
            recall_plan.append(("Task context", context_args, CONTEXT_RECALL_LIMIT))
            state["first_substantive_done"] = True
        elif is_explicit or topic_shift:
            recall_plan.append(
                (
                    "Task context",
                    {
                        "query": prompt[:500],
                        "time_query": f"last {CONTEXT_RECALL_WINDOW_DAYS} days",
                        "limit": CONTEXT_RECALL_LIMIT,
                        "format": "detailed",
                    },
                    CONTEXT_RECALL_LIMIT,
                )
            )

        if is_debug:
            recall_plan.append(
                (
                    "Debug context",
                    {
                        "query": prompt[:500],
                        "tags": ["bugfix", "solution"],
                        "limit": DEBUG_RECALL_LIMIT,
                        "format": "detailed",
                    },
                    DEBUG_RECALL_LIMIT,
                )
            )

        known_entities.update(entities)
        if not recall_plan:
            return ""

        sections: List[str] = []
        seen: Set[str] = set()
        for label, args, limit in recall_plan:
            try:
                response = self._client.recall(args)
            except Exception as exc:
                _debug("prefetch %s recall failed: %s", label.lower(), exc)
                continue
            section = _format_recall_section(label, response, seen, limit)
            if section:
                sections.append(section)

        if not sections:
            _debug("prefetch returned no displayable recall sections")
            return ""

        _debug(
            "prefetch returned %s section(s) for session=%s first_substantive=%s topic shift=%s debug=%s explicit=%s",
            len(sections),
            session_key,
            first_substantive,
            topic_shift,
            is_debug,
            is_explicit,
        )
        return "AutoMem recall:\n" + "\n\n".join(sections)

    def sync_turn(
        self,
        user_content: str,
        assistant_content: str,
        *,
        session_id: str = "",
        messages: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        if not self._active or not self._auto_capture or not self._write_enabled or not self._client:
            return
        clean_user = _clean_text(user_content)
        clean_assistant = _clean_text(assistant_content)
        if len(clean_user) < 20 or len(clean_assistant) < 20:
            return

        def _run() -> None:
            try:
                self._client.store(
                    {
                        "content": f"[role: user]\n{clean_user}\n\n[role: assistant]\n{clean_assistant}",
                        "tags": ["hermes", "conversation-turn"],
                        "metadata": {"source": "hermes_provider", "session_id": session_id},
                    }
                )
                _debug("auto-captured turn for session=%s", session_id)
            except Exception as exc:
                _debug("auto-capture failed: %s", exc)
                return

        if self._sync_thread and self._sync_thread.is_alive():
            self._sync_thread.join(timeout=2.0)
            if self._sync_thread.is_alive():
                # Previous write is still in flight after the join budget; skip
                # this turn rather than spawning a second thread and letting
                # daemon threads accumulate under sustained back-pressure.
                _debug(
                    "previous auto-capture still in flight; skipping turn for session=%s",
                    session_id,
                )
                return
        self._sync_thread = threading.Thread(target=_run, daemon=True, name="automem-sync")
        self._sync_thread.start()

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        if not _provider_tools_enabled():
            return []
        return [
            {
                "name": "automem_recall_memory",
                "description": "Recall relevant memories from AutoMem.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "tags": {"type": "array", "items": {"type": "string"}},
                        "limit": {"type": "integer", "minimum": 1, "maximum": MAX_EXPLICIT_RECALL_LIMIT},
                        "format": {"type": "string"},
                        "time_query": {"type": "string"},
                        "sort": {"type": "string"},
                    },
                },
            },
            {
                "name": "automem_store_memory",
                "description": "Store a durable memory in AutoMem.",
                "parameters": {
                    "type": "object",
                    "required": ["content"],
                    "properties": {
                        "content": {"type": "string"},
                        "tags": {"type": "array", "items": {"type": "string"}},
                        "importance": {"type": "number"},
                        "metadata": {"type": "object"},
                        "type": {"type": "string"},
                        "confidence": {"type": "number"},
                    },
                },
            },
            {
                "name": "automem_associate_memories",
                "description": "Create a typed relationship between two AutoMem memories.",
                "parameters": {
                    "type": "object",
                    "required": ["memory1_id", "memory2_id", "type", "strength"],
                    "properties": {
                        "memory1_id": {"type": "string"},
                        "memory2_id": {"type": "string"},
                        "type": {"type": "string"},
                        "strength": {"type": "number"},
                    },
                },
            },
            {
                "name": "automem_update_memory",
                "description": "Update an existing AutoMem memory.",
                "parameters": {
                    "type": "object",
                    "required": ["memory_id"],
                    "properties": {
                        "memory_id": {"type": "string"},
                        "content": {"type": "string"},
                        "tags": {"type": "array", "items": {"type": "string"}},
                        "importance": {"type": "number"},
                        "metadata": {"type": "object"},
                    },
                },
            },
            {
                "name": "automem_check_database_health",
                "description": "Check AutoMem backend health.",
                "parameters": {"type": "object", "additionalProperties": False},
            },
        ]

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
        if not self._client:
            return tool_error("AutoMem provider is not initialized")
        try:
            if tool_name == "automem_recall_memory":
                return json.dumps(self._client.recall(args))
            if tool_name == "automem_store_memory":
                return json.dumps(self._client.store(args))
            if tool_name == "automem_associate_memories":
                return json.dumps(self._client.associate(args))
            if tool_name == "automem_update_memory":
                return json.dumps(self._client.update(args))
            if tool_name == "automem_check_database_health":
                return json.dumps(self._client.health())
        except urllib.error.HTTPError as exc:
            return tool_error(f"AutoMem HTTP {exc.code}: {exc.reason}")
        except Exception as exc:
            return tool_error(f"AutoMem tool failed: {exc}")
        return tool_error(f"Unknown AutoMem tool: {tool_name}")

    def shutdown(self) -> None:
        if self._sync_thread and self._sync_thread.is_alive():
            self._sync_thread.join(timeout=5.0)
        self._sync_thread = None
        _debug("shutdown complete")


def register(ctx) -> None:
    ctx.register_memory_provider(AutoMemMemoryProvider())
