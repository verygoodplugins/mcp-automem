# capture-test-pattern.ps1 - Record test execution results to JSONL queue
# AutoMem hook for Copilot - queue-only, fail silently
try {
    $MEMORY_QUEUE = Join-Path $HOME ".copilot" "scripts" "memory-queue.jsonl"
    $LOG_FILE = Join-Path $HOME ".copilot" "logs" "test-patterns.log"

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
    if (-not [Console]::IsInputRedirected) { exit 0 }
    $inputText = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($inputText)) { exit 0 }

    $inputJson = $null
    try { $inputJson = $inputText | ConvertFrom-Json } catch { exit 0 }

    # Extract command
    $command = Convert-HookValueToString (Get-HookValue $inputJson @(
        "toolArgs.command",
        "toolInput.command",
        "tool_args.command",
        "tool_input.command"
    ))
    if ([string]::IsNullOrEmpty($command)) {
        $command = if ($env:CLAUDE_LAST_COMMAND) { $env:CLAUDE_LAST_COMMAND } elseif ($env:TOOL_NAME) { $env:TOOL_NAME } else { "" }
    }

    # Skip non-test commands
    if ([string]::IsNullOrEmpty($command)) { exit 0 }
    $testPattern = '(^|\s)(npm test|yarn test|pnpm test|vitest|jest|pytest|cargo test|go test|gradle test|mvn test|dotnet test|rspec|phpunit|mocha)'
    if ($command -notmatch $testPattern) { exit 0 }

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
    if ($exitCode -eq 0 -and $env:CLAUDE_EXIT_CODE) { $exitCode = [int]$env:CLAUDE_EXIT_CODE }

    # Detect test framework
    $testFramework = "unknown"
    $frameworkMap = @{
        'vitest'   = 'vitest'
        'jest'     = 'jest'
        'pytest'   = 'pytest'
        'mocha'    = 'mocha'
        'rspec'    = 'rspec'
        'phpunit'  = 'phpunit'
        'cargo'    = 'cargo test'
        'go'       = '(^|\s)go test'
        'dotnet'   = 'dotnet test'
    }
    foreach ($fw in $frameworkMap.GetEnumerator()) {
        if ($command -match $fw.Value) { $testFramework = $fw.Key; break }
    }
    if ($testFramework -eq "unknown" -and $command -match 'npm test|yarn test|pnpm test') { $testFramework = "npm" }

    # Detect project name
    $cwd = if ($inputJson.cwd) { $inputJson.cwd } else { (Get-Location).Path }
    $projectName = Split-Path $cwd -Leaf

    # Parse test counts from output
    $passed = 0; $failed = 0; $total = 0
    if (-not [string]::IsNullOrEmpty($output)) {
        # Common patterns: "X passed", "X failed", "Tests: X passed, Y failed"
        $passMatch = [regex]::Match($output, '(\d+)\s+(passed|passing)')
        $failMatch = [regex]::Match($output, '(\d+)\s+(failed|failing)')
        if ($passMatch.Success) { $passed = [int]$passMatch.Groups[1].Value }
        if ($failMatch.Success) { $failed = [int]$failMatch.Groups[1].Value }
        $total = $passed + $failed
    }

    # Determine importance
    $importance = 0.5
    $memType = "Context"
    if ($exitCode -ne 0 -or $failed -gt 0) { $importance = 0.85; $memType = "Insight" }
    elseif ($total -gt 0) { $importance = 0.5; $memType = "Context" }

    # Build content
    if ($exitCode -eq 0 -and $failed -eq 0) {
        $content = "Tests passed in $projectName using $testFramework ($passed passed)"
    } else {
        $content = "Tests failed in $projectName using $testFramework ($failed failed, $passed passed)"
    }
    if ($content.Length -gt 1500) { $content = $content.Substring(0, 1497) + "..." }

    # Build tags
    $frameworkToLang = @{ 'pytest'='python'; 'jest'='typescript'; 'vitest'='typescript'; 'mocha'='typescript'; 'cargo'='rust'; 'go'='go'; 'dotnet'='csharp'; 'rspec'='ruby'; 'phpunit'='php'; 'npm'='typescript' }
    $tags = @("test")
    if ($testFramework -ne "unknown") { $tags += $testFramework }
    $lang = $frameworkToLang[$testFramework]
    if ($lang) { $tags += $lang }
    if ($projectName) { $tags += $projectName }
    if ($exitCode -ne 0 -or $failed -gt 0) { $tags += "failure" }

    # Build JSONL record
    $record = @{
        content    = $content
        tags       = $tags
        importance = $importance
        type       = $memType
        metadata   = @{
            test_framework = $testFramework
            exit_code      = $exitCode
            passed         = $passed
            failed         = $failed
            total          = $total
            project        = $projectName
            command        = if ($command.Length -gt 500) { $command.Substring(0, 497) + "..." } else { $command }
        }
        timestamp  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
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
    Add-Content -Path $LOG_FILE -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Test result: passed=$passed, failed=$failed" -ErrorAction SilentlyContinue

    if ($failed -gt 0) { Write-Output "Test failures captured for analysis" }
    else { Write-Output "Test results stored" }

    exit 0
} catch {
    Write-Error "AutoMem hook error: $_"
    exit 0
}
