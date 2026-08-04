# automem-stop-nudge.ps1 - agentStop nudge for Copilot (opt-in, LLM-judged).
#
# If no store_memory call happened this session (sentinel from
# automem-track-store.ps1) AND the transcript shows a substantive session
# (>= 5 user turns), emit a one-shot decision:block whose `reason` re-wakes
# the agent for one closing turn. Guarded once-per-session. Advisory only:
# never errors the hook, always exits 0.
#
# Parity note: Copilot's agentStop output is {decision, reason} (block
# re-prompts using `reason`); unlike Claude's Stop it cannot inject hidden
# context, so this nudge ships only in the opt-in `full` profile. The
# transcript at transcriptPath is parsed best-effort - unreadable/unparseable
# stays silent (the safe failure).
try {
    $raw = ''
    if ([Console]::IsInputRedirected) { $raw = [Console]::In.ReadToEnd() }

    $sessionId = ''
    $transcriptPath = ''
    if ($raw) {
        $m = [regex]::Match($raw, '"session_?[iI]d"\s*:\s*"([^"]*)"')
        if ($m.Success) { $sessionId = $m.Groups[1].Value }
        $tm = [regex]::Match($raw, '"transcript_?[pP]ath"\s*:\s*"([^"]*)"')
        if ($tm.Success) { $transcriptPath = $tm.Groups[1].Value }
    }

    $sessionId = $sessionId -replace '[^A-Za-z0-9_-]', ''
    if (-not $sessionId) { exit 0 }

    $tmp = $env:TEMP
    if (-not $tmp) { $tmp = $env:TMP }
    if (-not $tmp) { $tmp = $env:TMPDIR }
    if (-not $tmp) { $tmp = [System.IO.Path]::GetTempPath() }
    $storedSentinel = Join-Path $tmp "automem-stored-$sessionId"
    $nudgedSentinel = Join-Path $tmp "automem-stop-nudged-$sessionId"
    if ((Test-Path $storedSentinel) -or (Test-Path $nudgedSentinel)) { exit 0 }

    # Transcript paths in the payload are JSON-escaped (\\ for \). Unescape so
    # Test-Path can resolve them; unreadable -> stay silent.
    if ($transcriptPath) { $transcriptPath = $transcriptPath -replace '\\\\', '\' }
    if (-not $transcriptPath -or -not (Test-Path $transcriptPath)) { exit 0 }
    $content = Get-Content -Raw -ErrorAction SilentlyContinue $transcriptPath
    if (-not $content) { exit 0 }

    $userTurns = 0
    foreach ($line in ($content -split "`r?`n")) {
        if (-not $line.Trim()) { continue }
        try {
            $event = $line | ConvertFrom-Json -ErrorAction Stop
            if ($event.type -eq 'user.message') { $userTurns += 1 }
        } catch {
            continue
        }
    }
    if ($userTurns -lt 5) { exit 0 }

    # Burn the once-per-session sentinel before emitting.
    New-Item -ItemType File -Path $nudgedSentinel -Force | Out-Null

    $reason = 'AutoMem: nothing was stored this session. If anything durable emerged - a correction, a stabilized decision, an articulated pattern, or a root-cause insight - recall first, then store it with store_memory and associate it. Otherwise end the turn without storing. Do not store session summaries, progress notes, or confirmations.'
    Write-Output (@{ decision = 'block'; reason = $reason } | ConvertTo-Json -Compress)
} catch {
    # Advisory hook: never surface errors.
    exit 0
}
exit 0
