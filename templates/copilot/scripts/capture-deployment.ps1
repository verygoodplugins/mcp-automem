# capture-deployment.ps1 - Record deployment events to JSONL queue
# AutoMem hook for Copilot - queue-only, fail silently
try {
    $MEMORY_QUEUE = Join-Path $HOME ".copilot" "scripts" "memory-queue.jsonl"
    $LOG_FILE = Join-Path $HOME ".copilot" "logs" "deployments.log"

    # Ensure directories exist
    $queueDir = Split-Path $MEMORY_QUEUE -Parent
    $logDir = Split-Path $LOG_FILE -Parent
    if (-not (Test-Path $queueDir)) { New-Item -ItemType Directory -Path $queueDir -Force | Out-Null }
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

    # Dedup: skip if identical content already queued recently
    function Test-Duplicate($queuePath, $newContent) {
        if (-not (Test-Path $queuePath)) { return $false }
        $hash = [System.Security.Cryptography.MD5]::Create()
        $newHash = [System.BitConverter]::ToString($hash.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($newContent))).Replace('-', '')
        $lines = Get-Content $queuePath -Tail 20 -ErrorAction SilentlyContinue
        foreach ($line in $lines) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            try {
                $existing = ($line | ConvertFrom-Json).content
                $existingHash = [System.BitConverter]::ToString($hash.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($existing))).Replace('-', '')
                if ($existingHash -eq $newHash) { return $true }
            } catch { continue }
        }
        return $false
    }

    # Read JSON from stdin
    if (-not [Console]::IsInputRedirected) { exit 0 }
    $inputText = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($inputText)) { exit 0 }

    $inputJson = $null
    try { $inputJson = $inputText | ConvertFrom-Json } catch { exit 0 }

    # Extract command
    $command = ""
    if ($inputJson.toolArgs -and $inputJson.toolArgs.command) { $command = $inputJson.toolArgs.command }
    elseif ($inputJson.tool_input -and $inputJson.tool_input.command) { $command = $inputJson.tool_input.command }
    if ([string]::IsNullOrEmpty($command)) {
        $command = if ($env:CLAUDE_LAST_COMMAND) { $env:CLAUDE_LAST_COMMAND } elseif ($env:TOOL_NAME) { $env:TOOL_NAME } else { "" }
    }

    # Skip non-deploy commands
    if ([string]::IsNullOrEmpty($command)) { exit 0 }
    $deployPattern = '(^|\s)(\./deploy[\w.-]*|kubectl apply|helm (install|upgrade)|docker push|az (webapp deploy|deployment (group )?create)|dotnet publish|aws (s3 sync|ecs|lambda)|gcloud (app deploy|run deploy)|terraform apply|pulumi up|cdk deploy|fly deploy|railway up|vercel deploy|vercel --prod|netlify deploy|firebase deploy|gh-pages)'
    if ($command -notmatch $deployPattern) { exit 0 }

    # Extract output and exit code
    $output = ""
    if ($inputJson.toolResult) {
        $output = if ($inputJson.toolResult.textResultForLlm) { $inputJson.toolResult.textResultForLlm } else { "$($inputJson.toolResult)" }
    }
    if ([string]::IsNullOrEmpty($output)) {
        $output = if ($env:CLAUDE_COMMAND_OUTPUT) { $env:CLAUDE_COMMAND_OUTPUT } else { "" }
    }

    $exitCode = 0
    if ($inputJson.toolResult -and $inputJson.toolResult.exit_code) { $exitCode = [int]$inputJson.toolResult.exit_code }
    elseif ($env:CLAUDE_EXIT_CODE) { $exitCode = [int]$env:CLAUDE_EXIT_CODE }

    # Detect deploy target
    $deployTarget = "unknown"
    $targetMap = @{
        'kubernetes' = 'kubectl apply'
        'helm'       = 'helm (install|upgrade)'
        'docker'     = 'docker push'
        'azure'      = 'az (webapp deploy|deployment)'
        'dotnet'     = 'dotnet publish'
        'aws'        = 'aws (s3 sync|ecs|lambda)'
        'gcloud'     = 'gcloud (app deploy|run deploy)'
        'terraform'  = 'terraform apply'
        'vercel'     = 'vercel'
        'netlify'    = 'netlify deploy'
        'fly'        = 'fly deploy'
        'railway'    = 'railway up'
    }
    foreach ($t in $targetMap.GetEnumerator()) {
        if ($command -match $t.Value) { $deployTarget = $t.Key; break }
    }

    # Detect deploy environment
    $deployEnv = "production"
    if ($command -match 'staging|stage|stg') { $deployEnv = "staging" }
    elseif ($command -match 'dev|develop') { $deployEnv = "development" }
    elseif ($command -match 'preview|canary') { $deployEnv = "preview" }

    # Detect project name
    $cwd = if ($inputJson.cwd) { $inputJson.cwd } else { (Get-Location).Path }
    $projectName = Split-Path $cwd -Leaf

    # Detect git commit
    $gitCommit = ""
    try { $gitCommit = (git rev-parse --short HEAD 2>$null) } catch { }

    # Determine importance
    $importance = 0.8
    $memType = "Context"
    if ($exitCode -ne 0) { $importance = 0.95; $memType = "Insight" }

    # Build content
    if ($exitCode -eq 0) {
        $content = "Deployment succeeded in $projectName to $deployTarget"
    } else {
        $content = "Deployment failed in $projectName to $deployTarget (exit code: $exitCode)"
    }
    if ($content.Length -gt 1500) { $content = $content.Substring(0, 1497) + "..." }

    # Build tags
    $tags = @("deployment")
    if ($deployTarget -ne "unknown") { $tags += $deployTarget }
    $tags += $deployEnv
    if ($projectName) { $tags += $projectName }
    if ($exitCode -ne 0) { $tags += "failure" }

    # Build JSONL record
    $nowIso = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    $record = @{
        content    = $content
        tags       = $tags
        importance = $importance
        type       = $memType
        metadata   = @{
            platform     = $deployTarget
            environment  = $deployEnv
            exit_code    = $exitCode
            project      = $projectName
            command      = if ($command.Length -gt 500) { $command.Substring(0, 497) + "..." } else { $command }
            git_commit   = if ($gitCommit) { $gitCommit } else { $null }
        }
        timestamp  = $nowIso
    }

    # Temporal validity: production deploys represent the currently live version
    if ($deployEnv -eq "production" -and $exitCode -eq 0) {
        $record["t_valid"] = $nowIso
    }

    $jsonLine = $record | ConvertTo-Json -Compress -Depth 5

    # Dedup check
    if (Test-Duplicate $MEMORY_QUEUE $content) { exit 0 }

    # Atomic append
    $stream = [System.IO.File]::Open($MEMORY_QUEUE, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
        $writer = [System.IO.StreamWriter]::new($stream, [System.Text.Encoding]::UTF8)
        $writer.WriteLine($jsonLine)
        $writer.Flush()
    } finally {
        if ($writer) { $writer.Dispose() }
        if ($stream) { $stream.Dispose() }
    }

    # Log
    Add-Content -Path $LOG_FILE -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Deployment captured: target=$deployTarget, exit=$exitCode" -ErrorAction SilentlyContinue

    if ($exitCode -ne 0) { Write-Output "Deployment failure captured for analysis" }
    else { Write-Output "Deployment details stored" }

    exit 0
} catch {
    Write-Error "AutoMem hook error: $_"
    exit 0
}
