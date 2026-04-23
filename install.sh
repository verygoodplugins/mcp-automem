#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
package_spec="${AUTOMEM_PACKAGE_SPEC:-@verygoodplugins/mcp-automem}"
default_endpoint="${AUTOMEM_DEFAULT_ENDPOINT:-http://127.0.0.1:8001}"
endpoint="${AUTOMEM_ENDPOINT:-}"
api_key="${AUTOMEM_API_KEY:-}"
scope="${AUTOMEM_OPENCLAW_SCOPE:-shared}"
selected_client="${AUTOMEM_CLIENT:-openclaw}"
replace_memory="${AUTOMEM_REPLACE_OPENCLAW_MEMORY:-0}"
tty_fd="3"
interactive="0"

open_tty() {
  if [[ "$interactive" == "1" ]]; then
    return 0
  fi

  if [[ ! -t 1 ]]; then
    return 1
  fi

  exec 3<>/dev/tty || return 1
  interactive="1"
  return 0
}

tty_print() {
  local message="$1"
  if [[ "$interactive" == "1" ]]; then
    printf "%s" "$message" >&"$tty_fd"
  else
    printf "%s" "$message"
  fi
}

read_line() {
  local prompt="$1"
  local default_value="${2:-}"
  local value=""

  if [[ "$interactive" != "1" ]]; then
    printf '%s' "$default_value"
    return 0
  fi

  if [[ -n "$default_value" ]]; then
    tty_print "$prompt [$default_value] "
  else
    tty_print "$prompt "
  fi

  IFS= read -r value <&"$tty_fd" || true
  if [[ -z "$value" ]]; then
    value="$default_value"
  fi
  printf '%s' "$value"
}

read_secret() {
  local prompt="$1"
  local value=""

  if [[ "$interactive" != "1" ]]; then
    printf '%s' "$api_key"
    return 0
  fi

  tty_print "$prompt "
  stty -echo <&"$tty_fd"
  IFS= read -r value <&"$tty_fd" || true
  stty echo <&"$tty_fd"
  tty_print $'\n'
  printf '%s' "$value"
}

confirm_prompt() {
  local prompt="$1"
  local default_answer="${2:-n}"
  local answer=""

  if [[ "$interactive" != "1" ]]; then
    [[ "$default_answer" =~ ^[yY]$ ]]
    return
  fi

  tty_print "$prompt "
  IFS= read -r answer <&"$tty_fd" || true
  if [[ -z "$answer" ]]; then
    answer="$default_answer"
  fi
  case "$answer" in
    [yY]|[yY][eE][sS]) return 0 ;;
    *) return 1 ;;
  esac
}

probe_endpoint() {
  local url="$1"
  local health_url="${url%/}/health"
  curl -fsSL --max-time 4 "$health_url" >/dev/null 2>&1
}

prompt_for_openclaw_inputs() {
  if [[ -z "$endpoint" ]]; then
    if ! open_tty; then
      endpoint="$default_endpoint"
      return 0
    fi

    if ! confirm_prompt "Do you want to install AutoMem to OpenClaw? (y|N)"; then
      tty_print "Install cancelled.\n"
      exit 0
    fi

    while [[ -z "$endpoint" ]]; do
      endpoint="$(read_line "What is your AutoMem URL?" "$default_endpoint")"
      endpoint="${endpoint//[$'\r\n']}"
      if [[ -z "$endpoint" ]]; then
        tty_print "A URL is required.\n"
        continue
      fi

      if probe_endpoint "$endpoint"; then
        tty_print "  ✓ AutoMem reachable at $endpoint\n"
      else
        tty_print "  ✗ Could not reach $endpoint/health. Check the URL, or confirm to proceed anyway.\n"
        if ! confirm_prompt "Use this URL anyway? (y|N)" "n"; then
          endpoint=""
        fi
      fi
    done
  fi

  if [[ "$interactive" != "1" ]]; then
    return 0
  fi

  if [[ -z "$api_key" ]]; then
    api_key="$(read_secret "AutoMem API key (optional — press Enter to skip for local installs):")"
    api_key="${api_key//[$'\r\n']}"
  fi

  if [[ "${AUTOMEM_REPLACE_OPENCLAW_MEMORY:-}" == "" ]]; then
    tty_print "\nOpenClaw ships with a built-in 'memory-core' plugin. AutoMem is a graph-vector\n"
    tty_print "memory service that persists across sessions. Most users should replace memory-core.\n"
    if confirm_prompt "Replace OpenClaw's built-in memory with AutoMem? (Y|n)" "y"; then
      replace_memory="1"
    else
      replace_memory="0"
    fi
  fi
}

wait_for_gateway_health() {
  local attempt=0
  local max_attempts=15
  while (( attempt < max_attempts )); do
    if openclaw health >/dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
  return 1
}

print_install_summary() {
  local key_note="not set"
  if [[ -n "$api_key" ]]; then
    key_note="set (length $(printf '%s' "$api_key" | wc -c | tr -d ' '))"
  fi
  local replace_note="no"
  if [[ "$replace_memory" == "1" ]]; then
    replace_note="yes"
  fi
  echo ""
  echo "────────────────────────────────────────────────────────────"
  echo "  AutoMem is installed in OpenClaw"
  echo "────────────────────────────────────────────────────────────"
  echo "  Endpoint          : $endpoint"
  echo "  API key           : $key_note"
  echo "  Replaced memory-core: $replace_note"
  echo "  OpenClaw config   : ~/.openclaw/openclaw.json (backup saved as *.bak)"
  echo "  Plugin installed  : ~/.openclaw/extensions/automem/"
  echo ""
  echo "  What to do next:"
  echo "    1. Open OpenClaw Chat and start a conversation."
  echo "    2. Your AI will recall preferences automatically on the first turn."
  echo "    3. Say things like \"let's ship it\" or \"actually, I prefer X\" to"
  echo "       trigger durable memory stores."
  echo ""
  echo "  Docs: https://github.com/verygoodplugins/mcp-automem/blob/main/templates/openclaw/OPENCLAW_SETUP.md"
  echo "────────────────────────────────────────────────────────────"
}

build_runner() {
  if [[ -f "$script_dir/dist/index.js" ]]; then
    runner=(node "$script_dir/dist/index.js")
  else
    runner=(npx -y "$package_spec")
  fi
}

run_openclaw_install() {
  local args=(openclaw --mode plugin --scope "$scope" --endpoint "$endpoint")
  if [[ -n "$api_key" ]]; then
    args+=(--api-key "$api_key")
  fi
  if [[ -n "${AUTOMEM_OPENCLAW_WORKSPACE:-}" ]]; then
    args+=(--workspace "$AUTOMEM_OPENCLAW_WORKSPACE")
  fi
  if [[ -n "${AUTOMEM_OPENCLAW_PLUGIN_SOURCE:-}" ]]; then
    args+=(--plugin-source "$AUTOMEM_OPENCLAW_PLUGIN_SOURCE")
  fi
  if [[ "$replace_memory" == "1" ]]; then
    args+=(--replace-memory)
  fi

  echo "Installing AutoMem into OpenClaw..."
  "${runner[@]}" "${args[@]}"
}

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to install AutoMem for OpenClaw." >&2
  exit 1
fi

if ! command -v openclaw >/dev/null 2>&1; then
  echo "OpenClaw not found. Installing it first..." >&2
  curl -fsSL https://openclaw.ai/install.sh | bash
fi

build_runner

case "$selected_client" in
  openclaw)
    prompt_for_openclaw_inputs
    run_openclaw_install
    ;;
  *)
    echo "Unsupported AutoMem client: $selected_client" >&2
    exit 1
    ;;
esac

echo "Restarting OpenClaw gateway..."
if ! node -e 'const { spawnSync } = require("child_process"); const result = spawnSync("openclaw", ["gateway", "restart"], { stdio: "ignore", timeout: 20000 }); if (result.error && result.error.code !== "ETIMEDOUT") process.exit(1); process.exit(result.status ?? 1);' >/dev/null 2>&1; then
  echo "OpenClaw gateway restart did not complete cleanly. Retry manually: openclaw gateway restart" >&2
  exit 1
fi

echo "Waiting for gateway to come back..."
if ! wait_for_gateway_health; then
  echo "Gateway did not report healthy within 30s. Check status: openclaw health" >&2
  exit 1
fi

echo "Verifying plugin install..."
if ! openclaw plugins inspect automem --json >/dev/null; then
  echo "Plugin not registered. Check: openclaw plugins list" >&2
  exit 1
fi

print_install_summary

if [[ "${AUTOMEM_NO_OPEN:-0}" == "1" ]]; then
  openclaw dashboard --no-open >/dev/null 2>&1 || true
  exit 0
fi

if [[ -t 1 ]]; then
  openclaw dashboard >/dev/null 2>&1 || openclaw dashboard --no-open >/dev/null 2>&1 || true
else
  openclaw dashboard --no-open >/dev/null 2>&1 || true
fi
