# automem-track-store.ps1 - PostToolUse tracker for store_memory calls.
# AutoMem hook for Copilot (Copilot CLI + VS Code).
#
# Writes a per-session sentinel so the opt-in agentStop nudge
# (automem-stop-nudge.ps1) stays quiet when a store already happened this
# session. Side-effect only: emits NO output (keeps the tool result
# unchanged), and always exits 0.
try {
    $raw = ''
    if ([Console]::IsInputRedirected) { $raw = [Console]::In.ReadToEnd() }

    $sessionId = ''
    $toolName = ''
    if ($raw) {
        $m = [regex]::Match($raw, '"session_?[iI]d"\s*:\s*"([^"]*)"')
        if ($m.Success) { $sessionId = $m.Groups[1].Value }
        $tm = [regex]::Match($raw, '"tool_?[nN]ame"\s*:\s*"([^"]*)"')
        if ($tm.Success) { $toolName = $tm.Groups[1].Value }
    }

    # Belt-and-suspenders: only record store_memory tool calls. An absent tool
    # name is allowed because the matcher already scoped the event.
    if ($toolName -and ($toolName -notlike '*store_memory')) { exit 0 }

    $sessionId = $sessionId -replace '[^A-Za-z0-9_-]', ''
    if ($sessionId) {
        $tempDirectory = $env:TEMP
        if (-not $tempDirectory) { $tempDirectory = $env:TMP }
        if (-not $tempDirectory) { $tempDirectory = $env:TMPDIR }
        if (-not $tempDirectory) { $tempDirectory = [System.IO.Path]::GetTempPath() }
        $sentinel = Join-Path $tempDirectory "automem-stored-$sessionId"
        New-Item -ItemType File -Path $sentinel -Force | Out-Null
    }
} catch {
    # Side-effect hook: never surface errors.
    exit 0
}
exit 0
