# python-command.ps1 - Locate Python executable on PATH
# AutoMem hook utility for Copilot
try {
    $pythonCmd = $null

    # Try python3 first
    $python3 = Get-Command python3 -ErrorAction SilentlyContinue
    if ($python3) {
        $pythonCmd = $python3.Source
    }

    # Try python next
    if (-not $pythonCmd) {
        $python = Get-Command python -ErrorAction SilentlyContinue
        if ($python) {
            # Verify it's Python 3
            $ver = & $python.Source --version 2>&1
            if ($ver -match 'Python 3') {
                $pythonCmd = $python.Source
            }
        }
    }

    # Try py -3 (Windows launcher)
    if (-not $pythonCmd) {
        $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
        if ($pyLauncher) {
            $ver = & py -3 --version 2>&1
            if ($ver -match 'Python 3') {
                $pythonCmd = "py -3"
            }
        }
    }

    if ($pythonCmd) {
        Write-Output $pythonCmd
    } else {
        Write-Error "AutoMem: Python 3 not found on PATH"
        exit 0
    }
} catch {
    Write-Error "AutoMem hook error: $_"
    exit 0
}
