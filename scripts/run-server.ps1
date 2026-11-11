# Supervisor started by the "cc-cockpit" scheduled task (see service.ps1).
# Runs the production server, logs to logs\server.log, restarts it with backoff if it exits.
# Windows PowerShell 5.1 compatible; keep this file ASCII.

$root = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $root 'server\dist\index.js'
$log = Join-Path $root 'logs\server.log'
$utf8 = New-Object System.Text.UTF8Encoding($false)

$env:CCC_LOG_FILE = $log
$env:NODE_ENV = 'production'
Set-Location $root
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null

function Write-Log([string]$msg) {
  $ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  [System.IO.File]::AppendAllText($log, "$ts SUPER [supervisor] $msg`r`n", $utf8)
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  Write-Log 'node not found in PATH'
  exit 1
}

$delay = 2
while ($true) {
  if (-not (Test-Path $entry)) {
    Write-Log "missing $entry (run: npm run build); retrying in 30 s"
    Start-Sleep -Seconds 30
    continue
  }
  $started = Get-Date
  Write-Log "starting server ($node)"
  & $node --disable-warning=ExperimentalWarning $entry
  $code = $LASTEXITCODE
  $ran = ((Get-Date) - $started).TotalSeconds
  # Ran a while = a real crash, restart fast. Crashing at boot (bad config, port taken) = back off.
  if ($ran -gt 60) { $delay = 2 } else { $delay = [Math]::Min($delay * 2, 60) }
  Write-Log ("server exited with code {0} after {1:N0} s; restart in {2} s" -f $code, $ran, $delay)
  Start-Sleep -Seconds $delay
}
