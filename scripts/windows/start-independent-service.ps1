param([string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'CodexMobile\Service\service.json'))
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$root = Split-Path $ConfigPath
$mutex = New-Object Threading.Mutex($false, 'Local\CodexMobile.IndependentService')
$hasMutex = $false
$job = $null
try {
    try { $hasMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $hasMutex = $true }
    if (-not $hasMutex) { throw '独立后台服务已经运行' }
    # 首次迁移时不终止普通桌面的 stdio app-server；等旧实例退出后才接管空闲端口。
    while ($true) {
        $servers = @(Get-CimInstance Win32_Process -Filter "Name = 'codex.exe'" | Where-Object { $_.CommandLine -match '(?:^|\s)app-server(?:\s|$)' })
        $ports = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
        $occupied = @($ports | Where-Object { $_.Port -in @([int]$config.ServerPort,[int]$config.PrivateServerPort,[int]$config.GatewayPort) })
        if ($servers.Count -eq 0 -and $occupied.Count -eq 0) { break }
        $waiting = @{ updateState='waiting-existing-server-or-port'; ready=$false; serviceProcessPid=$PID; existingServerCount=$servers.Count; occupiedPorts=@($occupied.Port) } | ConvertTo-Json
        [IO.File]::WriteAllText((Join-Path $root 'status.json'), $waiting, (New-Object Text.UTF8Encoding($false)))
        Start-Sleep -Seconds 2
    }
    $secret = (Get-Content -LiteralPath $config.TokenFile -Raw).Trim() | ConvertTo-SecureString
    $credential = New-Object Management.Automation.PSCredential('gateway', $secret)
    $env:CODEX_MOBILE_TOKEN = $credential.GetNetworkCredential().Password
    $env:CODEX_HOME = if ($config.CodexHome) { $config.CodexHome } else { Join-Path $env:USERPROFILE '.codex' }
    Add-Type -Path (Join-Path $PSScriptRoot 'OwnedProcessJob.cs')
    $job = New-Object CodexMobile.OwnedProcessJob
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $service = $job.Start($node, [string[]]@((Join-Path $PSScriptRoot 'service\run-service.mjs'),$ConfigPath),$root,$false)
    [Environment]::SetEnvironmentVariable('CODEX_MOBILE_TOKEN',$null,'Process')
    while (-not $service.HasExited) { Start-Sleep -Milliseconds 250 }
    if ($service.ExitCode -ne 0) { throw '后台服务异常退出；具体状态见私有日志' }
} finally {
    if ($null -ne $job) { $job.Dispose() }
    if ($hasMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
