# capture-build-result.ps1 - Record build outcomes to JSONL queue
# AutoMem hook for Copilot - queue-only, fail silently
try {
    $MEMORY_QUEUE = Join-Path $HOME ".copilot" "scripts" "memory-queue.jsonl"
    $LOG_FILE = Join-Path $HOME ".copilot" "logs" "build-results.log"

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

    function Get-HookValue($object, [string[]]$paths) {
        foreach ($path in $paths) {
            $current = $object
            foreach ($part in $path.Split('.')) {
                if ($null -eq $current) { break }
                $property = $current.PSObject.Properties[$part]
                if ($null -eq $property) {
                    $current = $null
                    break
                }
                $current = $property.Value
            }
            if ($null -ne $current -and "$current" -ne "") { return $current }
        }
        return $null
    }

    function Convert-HookValueToString($value) {
        if ($null -eq $value) { return "" }
        if ($value -is [string]) { return $value }
        return ($value | ConvertTo-Json -Compress -Depth 5)
    }

    # Read JSON from stdin
    $inputJson = $null
    $inputText = ""
    if (-not [Console]::IsInputRedirected) {
        exit 0
    }
    $inputText = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($inputText)) { exit 0 }

    try {
        $inputJson = $inputText | ConvertFrom-Json
    } catch {
        exit 0
    }

    # Extract command from JSON or env vars
    $command = Convert-HookValueToString (Get-HookValue $inputJson @(
        "toolArgs.command",
        "toolInput.command",
        "tool_args.command",
        "tool_input.command"
    ))
    if ([string]::IsNullOrEmpty($command)) {
        $command = if ($env:CLAUDE_LAST_COMMAND) { $env:CLAUDE_LAST_COMMAND } elseif ($env:TOOL_NAME) { $env:TOOL_NAME } else { "" }
    }

    # Skip non-build commands
    if ([string]::IsNullOrEmpty($command)) { exit 0 }
    $buildPattern = '(^|\s)(npm (run )?build|yarn build|pnpm build|vite build|webpack|rollup|parcel|go build|cargo build|dotnet build|msbuild|bicep build|az bicep build|gradle|mvn|make|composer)'
    if ($command -notmatch $buildPattern) { exit 0 }

    # Extract output
    $output = Convert-HookValueToString (Get-HookValue $inputJson @(
        "toolResult.textResultForLlm",
        "toolResult.output",
        "tool_result.text_result_for_llm",
        "tool_response.textResultForLlm",
        "tool_response.output",
        "toolResponse.textResultForLlm",
        "toolResponse.output",
        "tool_response",
        "toolResult"
    ))
    if ([string]::IsNullOrEmpty($output)) {
        $output = if ($env:CLAUDE_COMMAND_OUTPUT) { $env:CLAUDE_COMMAND_OUTPUT } else { "" }
    }

    # Extract exit code
    $exitCodeValue = Get-HookValue $inputJson @(
        "toolResult.exitCode",
        "toolResult.exit_code",
        "tool_result.exit_code",
        "tool_response.exitCode",
        "tool_response.exit_code",
        "toolResponse.exitCode",
        "toolResponse.exit_code"
    )
    $exitCode = if ($null -ne $exitCodeValue -and "$exitCodeValue" -ne "") { [int]$exitCodeValue } else { 0 }
    if ($exitCode -eq 0 -and $env:CLAUDE_EXIT_CODE) {
        $exitCode = [int]$env:CLAUDE_EXIT_CODE
    }

    # Detect build tool
    $buildTool = "unknown"
    $toolMap = @{
        'npm'     = 'npm (run )?build|npm build'
        'yarn'    = 'yarn build'
        'pnpm'    = 'pnpm build'
        'webpack' = 'webpack'
        'vite'    = 'vite build'
        'rollup'  = 'rollup'
        'parcel'  = 'parcel'
        'cargo'   = 'cargo build'
        'go'      = '(^|\s)go build'
        'gradle'  = 'gradle'
        'mvn'     = 'mvn'
        'make'    = 'make'
        'dotnet'  = 'dotnet build|msbuild'
        'bicep'   = 'bicep build|az bicep build'
        'composer' = 'composer'
    }
    foreach ($tool in $toolMap.GetEnumerator()) {
        if ($command -match $tool.Value) { $buildTool = $tool.Key; break }
    }

    # Detect project name
    $cwd = if ($inputJson.cwd) { $inputJson.cwd } else { (Get-Location).Path }
    $projectName = Split-Path $cwd -Leaf

    # Count errors and warnings in output
    $errors = 0
    $warnings = 0
    if (-not [string]::IsNullOrEmpty($output)) {
        $errors = ([regex]::Matches($output, '(?i)(ERROR|error:|Error:)')).Count
        $warnings = ([regex]::Matches($output, '(?i)warning')).Count
    }

    # Determine importance
    $importance = 0.5
    $memType = "Context"
    if ($exitCode -ne 0) { $importance = 0.9; $memType = "Insight" }
    elseif ($errors -gt 0) { $importance = 0.8; $memType = "Insight" }
    elseif ($warnings -gt 5) { $importance = 0.6; $memType = "Pattern" }

    # Build content string
    if ($exitCode -eq 0) {
        $content = "Build succeeded in $projectName using $buildTool"
    } else {
        $content = "Build failed in $projectName using ${buildTool}: $errors errors"
    }
    if ($content.Length -gt 1500) { $content = $content.Substring(0, 1497) + "..." }

    # Build tags
    $toolToLang = @{ 'npm'='typescript'; 'yarn'='typescript'; 'pnpm'='typescript'; 'webpack'='typescript'; 'vite'='typescript'; 'cargo'='rust'; 'go'='go'; 'dotnet'='csharp'; 'bicep'='bicep'; 'gradle'='java'; 'mvn'='java'; 'make'='c'; 'composer'='php' }
    $tags = @("build")
    if ($buildTool -ne "unknown") { $tags += $buildTool }
    $lang = $toolToLang[$buildTool]
    if ($lang) { $tags += $lang }
    if ($projectName) { $tags += $projectName }
    if ($exitCode -ne 0) { $tags += "failure" }

    # Build JSONL record
    $record = @{
        content    = $content
        tags       = $tags
        importance = $importance
        type       = $memType
        metadata   = @{
            build_tool = $buildTool
            exit_code  = $exitCode
            warnings   = $warnings
            errors     = $errors
            project    = $projectName
            command    = if ($command.Length -gt 500) { $command.Substring(0, 497) + "..." } else { $command }
        }
        timestamp  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    }

    $jsonLine = $record | ConvertTo-Json -Compress -Depth 5

    # Dedup check
    if (Test-Duplicate $MEMORY_QUEUE $content) { exit 0 }

    # Atomic append with file locking
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
    $logMsg = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Build result captured: exit_code=$exitCode, errors=$errors, warnings=$warnings"
    Add-Content -Path $LOG_FILE -Value $logMsg -ErrorAction SilentlyContinue

    # Feedback
    if ($exitCode -ne 0) { Write-Output "Build failure captured for analysis" }
    elseif ($warnings -gt 0) { Write-Output "Build warnings recorded for improvement" }
    else { Write-Output "Successful build metrics stored" }

    exit 0
} catch {
    Write-Error "AutoMem hook error: $_"
    exit 0
}
