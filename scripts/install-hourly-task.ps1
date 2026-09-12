[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$TaskName = '피봇스윙매매 대시보드 갱신',
    [string]$NodePath = ''
)
$ErrorActionPreference = 'Stop'
$deskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $NodePath) { $NodePath = (Get-Command node.exe -ErrorAction Stop).Source }
$NodePath = [IO.Path]::GetFullPath($NodePath)
$runnerPath = Join-Path $deskRoot 'scripts/refresh-all.mjs'
$hiddenPath = Join-Path $deskRoot 'scripts/refresh-all-hidden.vbs'
$wscriptPath = Join-Path $env:SystemRoot 'System32/wscript.exe'
foreach ($candidate in @($NodePath, $runnerPath, $hiddenPath, $wscriptPath)) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw "Required file missing: $candidate" }
    if ($candidate.Contains('"')) { throw 'A task path cannot contain a quote' }
}
$taskUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskNow = Get-Date
$nextRun = $taskNow.Date.AddHours($taskNow.Hour).AddMinutes(5)
if ($nextRun -le $taskNow) { $nextRun = $nextRun.AddHours(1) }
$taskArguments = '"{0}" "{1}" "{2}" "{3}"' -f $hiddenPath, $NodePath, $runnerPath, $deskRoot
$description = "PNL404 hourly collection, validation and deployment from $deskRoot; current logged-in user; real child exit codes retained."
if (-not $PSCmdlet.ShouldProcess($TaskName, "Back up and replace hourly task for $deskRoot (next $nextRun)")) { return }

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$backupPath = $null
if ($existingTask) {
    if ($existingTask.State -eq 'Running') { throw 'Existing task is running; do not replace an active publisher' }
    $backupDirectory = Join-Path $deskRoot '_workspace/hourly-refresh/task-backups'
    [IO.Directory]::CreateDirectory($backupDirectory) | Out-Null
    $backupPath = Join-Path $backupDirectory ('task-{0}-{1}.xml' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), [Guid]::NewGuid().ToString('N'))
    $oldXml = Export-ScheduledTask -TaskName $TaskName -TaskPath $existingTask.TaskPath
    [IO.File]::WriteAllText($backupPath, $oldXml, [Text.Encoding]::Unicode)
}
$action = New-ScheduledTaskAction -Execute $wscriptPath -Argument $taskArguments -WorkingDirectory $deskRoot
$trigger = New-ScheduledTaskTrigger -Once -At $nextRun -RepetitionInterval (New-TimeSpan -Hours 1)
$principal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 55) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$taskPath = if ($existingTask) { $existingTask.TaskPath } else { '\' }
Register-ScheduledTask -TaskName $TaskName -TaskPath $taskPath -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description $description -Force | Out-Null
$installed = Get-ScheduledTask -TaskName $TaskName -TaskPath $taskPath
[PSCustomObject]@{
    TaskName = $installed.TaskName
    State = $installed.State
    WorkingDirectory = $deskRoot
    User = $taskUser
    NextConfiguredRun = $nextRun.ToString('o')
    Repetition = $installed.Triggers[0].Repetition.Interval
    ExecutionTimeLimit = $installed.Settings.ExecutionTimeLimit
    Backup = $backupPath
    RequiresLoggedInUser = $true
} | ConvertTo-Json
