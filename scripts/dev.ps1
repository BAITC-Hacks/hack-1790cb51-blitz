param([switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $projectRoot 'backend'
$frontendDir = Join-Path $projectRoot 'frontend'
$pythonPath = Join-Path $backendDir '.venv\Scripts\python.exe'
$taskProcesses = @()

if (-not (Test-Path -LiteralPath $pythonPath)) {
    & python -m venv (Join-Path $backendDir '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.12+ is required to create a virtual environment.' }
}
if (-not $SkipInstall) {
    & $pythonPath -m pip install -r (Join-Path $backendDir 'requirements.lock.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Backend dependency installation failed.' }
    Push-Location $frontendDir
    try {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
    } finally { Pop-Location }
}
foreach ($port in @(8000, 5173)) {
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
        throw "Port $port is already in use. Stop the existing server before starting ATLAS."
    }
}
$logDir = Join-Path $projectRoot 'data'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
try {
    $taskProcesses += Start-Process -FilePath $pythonPath -ArgumentList '-m uvicorn app.main:app --host 127.0.0.1 --port 8000' -WorkingDirectory $backendDir -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'backend.log') -RedirectStandardError (Join-Path $logDir 'backend-error.log')
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    $vitePath = Join-Path $frontendDir 'node_modules\vite\bin\vite.js'
    $taskProcesses += Start-Process -FilePath $nodePath -ArgumentList @("`"$vitePath`"", '--host', '127.0.0.1', '--port', '5173', '--strictPort') -WorkingDirectory $frontendDir -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'frontend.log') -RedirectStandardError (Join-Path $logDir 'frontend-error.log')
    Write-Host 'ATLAS: http://127.0.0.1:5173 | API: http://127.0.0.1:8000/docs'
    Write-Host 'Logs: data/ | Press Ctrl+C to stop both servers.'
    while ($true) {
        Start-Sleep -Seconds 2
        foreach ($taskProcess in $taskProcesses) {
            $taskProcess.Refresh()
            if ($taskProcess.HasExited) { throw 'A server stopped. Check the logs in data/.' }
        }
    }
} finally {
    foreach ($taskProcess in $taskProcesses) {
        if (-not $taskProcess.HasExited) { Stop-Process -Id $taskProcess.Id -ErrorAction SilentlyContinue }
    }
}
