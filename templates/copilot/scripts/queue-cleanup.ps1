# queue-cleanup.ps1 - Deduplicate and archive the JSONL queue file
# AutoMem hook for Copilot - queue-only, fail silently, no Python dependency
try {
    $QUEUE_FILE = Join-Path $HOME ".copilot" "scripts" "memory-queue.jsonl"
    $LOG_FILE = Join-Path $HOME ".copilot" "logs" "queue-cleanup.log"
    $ARCHIVE_DIR = Join-Path $HOME ".copilot" "logs" "archive"

    $logDir = Split-Path $LOG_FILE -Parent
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

    function Write-Log($msg) {
        $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Add-Content -Path $LOG_FILE -Value "[$ts] $msg" -ErrorAction SilentlyContinue
    }

    # Check if queue exists and is non-empty
    if (-not (Test-Path $QUEUE_FILE) -or (Get-Item $QUEUE_FILE).Length -eq 0) {
        Write-Log "Queue file empty or doesn't exist, nothing to clean"
        exit 0
    }

    # Read all lines
    $lines = Get-Content $QUEUE_FILE -Encoding UTF8 -ErrorAction Stop
    $originalCount = $lines.Count

    if ($originalCount -eq 0) {
        Write-Log "Queue file has no entries"
        exit 0
    }

    # Deduplicate by content hash
    $seen = @{}
    $unique = @()
    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }

        try {
            $entry = $trimmed | ConvertFrom-Json
            $contentKey = $entry.content
            if (-not $contentKey) { $contentKey = $trimmed }
        } catch {
            $contentKey = $trimmed
        }

        # Use MD5 hash of content as dedup key
        $md5 = [System.Security.Cryptography.MD5]::Create()
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($contentKey)
        $hash = [System.BitConverter]::ToString($md5.ComputeHash($bytes)) -replace '-', ''

        if (-not $seen.ContainsKey($hash)) {
            $seen[$hash] = $true
            $unique += $trimmed
        }
    }

    $removedCount = $originalCount - $unique.Count

    # Archive the old queue if entries were removed
    if ($removedCount -gt 0) {
        if (-not (Test-Path $ARCHIVE_DIR)) { New-Item -ItemType Directory -Path $ARCHIVE_DIR -Force | Out-Null }
        $archiveName = "memory-queue.$(Get-Date -Format 'yyyyMMdd-HHmmss').jsonl"
        $archivePath = Join-Path $ARCHIVE_DIR $archiveName
        Copy-Item $QUEUE_FILE $archivePath -ErrorAction SilentlyContinue
        Write-Log "Archived queue to $archivePath"
    }

    # Write deduplicated queue back
    $unique | Set-Content $QUEUE_FILE -Encoding UTF8

    Write-Log "Queue cleanup: $originalCount entries -> $($unique.Count) unique ($removedCount duplicates removed)"

    if ($removedCount -gt 0) {
        Write-Output "Queue cleaned: removed $removedCount duplicate entries"
    }

    exit 0
} catch {
    Write-Error "AutoMem hook error: $_"
    exit 0
}
