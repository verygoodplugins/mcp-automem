#!/bin/sh
# AutoMem one-line installer:  curl -fsSL https://get.automem.ai | sh
#
# Deliberately tiny. It makes sure Node.js is present, then hands over to the
# guided installer (`npx @verygoodplugins/mcp-automem install`), which asks a few
# plain questions and defaults to a private, local Docker install. Extra
# arguments are forwarded:  curl -fsSL https://get.automem.ai | sh -s -- --dry-run
set -eu

PACKAGE="${AUTOMEM_PACKAGE_SPEC:-@verygoodplugins/mcp-automem@latest}"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

# The package supports ^20.19 || ^22.13 || >=24. Be strict enough to avoid a
# confusing engine failure later, simple enough to read.
node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>=24||(a===22&&b>=13)||(a===20&&b>=19)?0:1)' 2>/dev/null
}

if ! node_ok; then
  printf 'AutoMem needs Node.js 20.19+ (or 22.13+). It is missing or too old.\n' >&2
  if command -v brew >/dev/null 2>&1 && ( : </dev/tty ) 2>/dev/null; then
    printf 'Install it now with Homebrew (brew install node)? [Y/n] ' >&2
    read -r answer </dev/tty || answer=n
    case "${answer:-y}" in
      [nN]*) fail 'Install Node.js from https://nodejs.org, then run this again.' ;;
    esac
    brew install node || fail 'Homebrew could not install Node.js. Install it from https://nodejs.org and run this again.'
    node_ok || fail 'Node.js is still unavailable. Open a new terminal and run this again.'
  else
    fail 'Install Node.js from https://nodejs.org, then run this again.'
  fi
fi

# When piped from curl, stdin is the script itself. Hand the installer the real
# terminal so its questions work; with no terminal it prints a preview instead.
if [ ! -t 0 ] && ( : </dev/tty ) 2>/dev/null; then
  exec npx -y "$PACKAGE" install "$@" </dev/tty
fi
exec npx -y "$PACKAGE" install "$@"
