# cc-cockpit as a Windows background service (Task Scheduler, no extra tools).
#   npm run service -- install [-AtStartup]   register (default: start at your logon)
#   npm run service -- start | stop | restart | status | logs | uninstall
# -AtStartup: start with the PC, before anyone logs on. Needs an admin shell and your Windows password.
# Windows PowerShell 5.1 compatible; keep this file ASCII.

param(
  [Parameter(Position = 0)]
  [ValidateSet('install', 'uninstall', 'start', 'stop', 'restart', 'status', 'logs')]
  [string]$Action = 'status',
  [switch]$AtStartup
)

$ErrorActionPreference = 'Stop'
$TaskName = 'cc-cockpit'
$root = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $root 'scripts\run-server.ps1'
$entry = Join-Path $root 'server\dist\index.js'
$log = Join-Path $root 'logs\server.log'
$user = "$env:USERDOMAIN\$env:USERNAME"

function Get-Port {
  $file = if ($env:CCC_CONFIG) { $env:CCC_CONFIG } else { Join-Path $root 'config.json' }
  try { return [int](Get-Content $file -Raw | ConvertFrom-Json).port } catch { return 7420 }
}

function Get-Task { Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }

function Get-ServerProcs {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'powershell.exe' OR Name = 'pwsh.exe'" |
    Where-Object { $_.CommandLine -and ($_.CommandLine.Contains($entry) -or $_.CommandLine.Contains($runner)) }
}

function Test-Health {
  try {
    return Invoke-RestMethod -Uri "http://127.0.0.1:$(Get-Port)/api/health" -TimeoutSec 2
  } catch {
    return $null
  }
}

function Wait-Health([int]$seconds) {
  for ($i = 0; $i -lt $seconds; $i++) {
    $h = Test-Health
    if ($h) { return $h }
    Start-Sleep -Seconds 1
  }
  return $null
}

function Stop-Server {
  if (Get-Task) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
  # Supervisor first (so it does not restart node), then node. The PTYs die with node;
  # their sessions are saved and come back on the next start.
  $procs = @(Get-ServerProcs) | Sort-Object { $_.Name -eq 'node.exe' }
  foreach ($p in $procs) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "stopped $($p.Name) $($p.ProcessId)"
  }
}

switch ($Action) {
  'install' {
    if (-not (Test-Path $entry)) { throw "Build first: npm run build ($entry not found)" }
    $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $act = New-ScheduledTaskAction -Execute $ps -WorkingDirectory $root `
      -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`""
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
      -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    $desc = 'cc-cockpit server (Claude Code sessions over Tailscale). Logs: logs\server.log'

    if ($AtStartup) {
      $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
      if (-not $admin) { throw '-AtStartup needs an administrator shell.' }
      # A real password logon (not S4U): Git credentials, DPAPI and network drives keep working.
      $cred = Get-Credential -UserName $user -Message 'Windows password of the account that runs Claude Code'
      $trigger = New-ScheduledTaskTrigger -AtStartup
      Register-ScheduledTask -TaskName $TaskName -Action $act -Trigger $trigger -Settings $settings `
        -User $cred.UserName -Password $cred.GetNetworkCredential().Password -RunLevel Limited `
        -Description $desc -Force | Out-Null
      Write-Host "Installed: starts with the PC as $($cred.UserName)."
    } else {
      $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
      $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
      Register-ScheduledTask -TaskName $TaskName -Action $act -Trigger $trigger -Settings $settings `
        -Principal $principal -Description $desc -Force | Out-Null
      Write-Host "Installed: starts when $user logs on."
    }
    if (Test-Health) { Write-Host 'A server is already running; run "npm run service -- restart" to hand it to the task.' }
    else {
      Start-ScheduledTask -TaskName $TaskName
      $h = Wait-Health 20
      if ($h) { Write-Host "Running on http://127.0.0.1:$(Get-Port)" } else { Write-Warning "Not answering yet; see $log" }
    }
  }

  'uninstall' {
    Stop-Server
    if (Get-Task) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
    Write-Host 'Uninstalled.'
  }

  'start' {
    if (-not (Get-Task)) { throw 'Not installed: npm run service -- install' }
    if (Test-Health) { Write-Host 'Already running.'; break }
    Start-ScheduledTask -TaskName $TaskName
    if (Wait-Health 20) { Write-Host 'Running.' } else { Write-Warning "Not answering yet; see $log" }
  }

  'stop' { Stop-Server }

  'restart' {
    Stop-Server
    Start-Sleep -Seconds 1
    Start-ScheduledTask -TaskName $TaskName
    if (Wait-Health 20) { Write-Host 'Running.' } else { Write-Warning "Not answering yet; see $log" }
  }

  'status' {
    $t = Get-Task
    if ($t) {
      $i = $t | Get-ScheduledTaskInfo
      $trig = if ($t.Triggers[0].CimClass.CimClassName -like '*Boot*') { 'PC startup' } else { 'logon' }
      Write-Host ("task      {0} (starts at {1}), last run {2}, result 0x{3:X}" -f $t.State, $trig, $i.LastRunTime, $i.LastTaskResult)
    } else {
      Write-Host 'task      not installed'
    }
    foreach ($p in Get-ServerProcs) { Write-Host ("process   {0} {1}" -f $p.Name, $p.ProcessId) }
    $h = Test-Health
    if ($h) { Write-Host ("health    ok, protocol {0}, up {1} s" -f $h.protocol, $h.uptimeSec) }
    else { Write-Host "health    no answer on 127.0.0.1:$(Get-Port)" }
    if (Test-Path $log) {
      Write-Host "log       $log"
      Get-Content $log -Tail 8 | ForEach-Object { Write-Host "  $_" }
    }
  }

  'logs' {
    if (-not (Test-Path $log)) { throw "No log yet: $log" }
    Get-Content $log -Tail 60 -Wait
  }
}
