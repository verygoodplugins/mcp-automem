# session-memory.ps1 - Process session context at session end
# AutoMem hook for Copilot - queue-only, fail silently
try {
    $MEMORY_QUEUE = Join-Path $HOME ".copilot" "scripts" "memory-queue.jsonl"
    $LOG_FILE = Join-Path $HOME ".copilot" "logs" "session-memory.log"
    $PROCESSOR = Join-Path $HOME ".copilot" "scripts" "process-session-memory.py"

    # Ensure directories exist
    $queueDir = Split-Path $MEMORY_QUEUE -Parent
    $logDir = Split-Path $LOG_FILE -Parent
    if (-not (Test-Path $queueDir)) { New-Item -ItemType Directory -Path $queueDir -Force | Out-Null }
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

    function Write-Log($msg) {
        $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Add-Content -Path $LOG_FILE -Value "[$ts] $msg" -ErrorAction SilentlyContinue
    }

    Write-Log "Session memory hook triggered"

    # Gather project context
    $cwd = (Get-Location).Path
    $projectName = Split-Path $cwd -Leaf
    $gitBranch = ""
    $gitRepo = ""
    $recentCommits = ""
    $fileChanges = ""
    $diffStats = ""
    $stagedStats = ""

    # Git context
    $isGit = $false
    try {
        $null = git rev-parse --git-dir 2>$null
        if ($LASTEXITCODE -eq 0) { $isGit = $true }
    } catch { }

    if ($isGit) {
        try { $gitBranch = git branch --show-current 2>$null } catch { }
        try {
            $remote = git remote get-url origin 2>$null
            if ($remote) { $gitRepo = $remote -replace '.*[:/]([^/]*/[^/]*)\.git$', '$1' }
        } catch { }
        try { $recentCommits = git log --since="1 hour ago" --pretty=format:"%h|%s|%an|%ad" --date=relative 2>$null } catch { }
        try { $fileChanges = git status --porcelain 2>$null } catch { }
        try { $diffStats = git diff --stat 2>$null } catch { }
        try { $stagedStats = git diff --cached --stat 2>$null } catch { }
        Write-Log "Git context: repo=$gitRepo, branch=$gitBranch"
    }

    # Build session context
    $context = @{
        session_data = @{
            timestamp         = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            project_name      = $projectName
            working_directory = $cwd
            git_branch        = $gitBranch
            git_repo          = $gitRepo
            hook_type         = if ($env:CLAUDE_HOOK_TYPE) { $env:CLAUDE_HOOK_TYPE } else { "session_end" }
            session_id        = if ($env:CLAUDE_SESSION_ID) { $env:CLAUDE_SESSION_ID } else { "unknown" }
        }
        recent_commits = if ($recentCommits) { $recentCommits } else { "" }
        file_changes   = if ($fileChanges) { $fileChanges } else { "" }
        diff_stats     = if ($diffStats) { $diffStats } else { "" }
        staged_stats   = if ($stagedStats) { $stagedStats } else { "" }
        environment    = @{
            user     = $env:USERNAME
            hostname = $env:COMPUTERNAME
            platform = "Windows"
        }
    }

    # Try to use Python processor if available
    if (Test-Path $PROCESSOR) {
        $tempFile = [System.IO.Path]::GetTempFileName()
        try {
            $context | ConvertTo-Json -Depth 5 | Set-Content -Path $tempFile -Encoding UTF8

            # Find Python
            $pythonCmd = $null
            $python3 = Get-Command python3 -ErrorAction SilentlyContinue
            if ($python3) { $pythonCmd = "python3" }
            if (-not $pythonCmd) {
                $python = Get-Command python -ErrorAction SilentlyContinue
                if ($python) { $pythonCmd = "python" }
            }
            if (-not $pythonCmd) {
                $py = Get-Command py -ErrorAction SilentlyContinue
                if ($py) { $pythonCmd = "py" }
            }

            if ($pythonCmd) {
                Write-Log "Processing session with Python processor"
                $proc = Start-Process -FilePath $pythonCmd -ArgumentList "`"$PROCESSOR`" `"$tempFile`"" -NoNewWindow -Wait -PassThru -RedirectStandardOutput "$logDir\session-processor.out" -RedirectStandardError "$logDir\session-processor.err"
                if ($proc.ExitCode -eq 0) {
                    Write-Log "Session memory processed successfully"
                } else {
                    Write-Log "Session memory processing failed with code $($proc.ExitCode)"
                }
            } else {
                Write-Log "Python not found - skipping session processor"
            }
        } finally {
            Remove-Item $tempFile -ErrorAction SilentlyContinue
        }
    } else {
        Write-Log "Memory processor not found at $PROCESSOR"
    }

    # Feedback
    if ($fileChanges -or $recentCommits) {
        Write-Output "Session milestone captured for analysis"
    }

    exit 0
} catch {
    Write-Error "AutoMem hook error: $_"
    exit 0
}
