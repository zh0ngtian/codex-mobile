param([Parameter(Mandatory=$true)][string]$SpecPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$spec = Get-Content -LiteralPath $SpecPath -Raw -Encoding UTF8 | ConvertFrom-Json
Add-Type -Path (Join-Path $PSScriptRoot 'OwnedProcessJob.cs')
$job = New-Object CodexMobile.OwnedProcessJob
try {
    $process = $job.Start([string]$spec.executable, [string[]]$spec.arguments, [string]$spec.workingDirectory, $false)
    Write-Output ('SERVICE_CHILD_PID=' + $process.Id)
    while (-not $process.HasExited) { Start-Sleep -Milliseconds 100 }
    $exitCode = $process.ExitCode
} finally { $job.Dispose() }
exit $exitCode
