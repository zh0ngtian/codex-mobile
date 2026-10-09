param(
    [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'CodexMobile\shared-session.json'),
    [switch]$Check
)
$ErrorActionPreference = 'Stop'

# 候选启动器：真实桌面/服务双端验证通过前，不替换系统现有启动项。
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$package = Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1
if (-not $package) { throw '未找到已安装的 OpenAI.Codex 桌面应用' }
$appDirectory = Join-Path $package.InstallLocation 'app'
$desktopExe = Join-Path $appDirectory 'ChatGPT.exe'
$serverExe = Join-Path $appDirectory 'resources\codex.exe'
$gatewayEntry = Join-Path $config.RepositoryPath 'npm-dist\server\index.js'
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
# 32 位 PowerShell 会把 System32 重定向到 SysWOW64；通过 Sysnative 访问系统 SSH 客户端。
$nativeSystemDirectory = if ([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess) { 'Sysnative' } else { 'System32' }
$sshExe = Join-Path $env:WINDIR "$nativeSystemDirectory\OpenSSH\ssh.exe"
$jobSource = Join-Path $PSScriptRoot 'OwnedProcessJob.cs'

foreach ($path in @($desktopExe, $serverExe, $gatewayEntry, $nodeExe, $sshExe, $config.IdentityFile, $config.TokenFile, $jobSource)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "缺少文件：$path" }
}
foreach ($port in @($config.ServerPort, $config.GatewayPort, $config.RemotePort)) {
    if ([int]$port -lt 1024 -or [int]$port -gt 65535) { throw '端口必须在 1024 到 65535 之间' }
}
if ($config.ServerPort -eq $config.GatewayPort) { throw '网关和 app-server 不能占用相同端口' }
$desktopProcesses = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'ChatGPT.exe' -and $_.ExecutablePath -eq $desktopExe -and $_.CommandLine -notmatch '--type='
})
$portsInUse = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {
    $_.LocalPort -in @([int]$config.ServerPort, [int]$config.GatewayPort)
})
$otherServers = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'codex.exe' -and $_.CommandLine -match '\sapp-server(?:\s|$)'
})
if ($Check) {
    [pscustomobject]@{
        PackageVersion = $package.Version.ToString()
        DesktopExecutable = $desktopExe
        ServerExecutable = $serverExe
        ExistingDesktopPids = @($desktopProcesses.ProcessId)
        ExistingServerPids = @($otherServers.ProcessId)
        OccupiedPorts = @($portsInUse.LocalPort)
        ExternalUrl = $config.ExternalUrl
        ActivationReady = ($desktopProcesses.Count -eq 0 -and $otherServers.Count -eq 0 -and $portsInUse.Count -eq 0)
    } | ConvertTo-Json -Depth 3
    return
}
if ($desktopProcesses.Count) { throw '请先从托盘完全退出桌面 Codex；启动器不会终止已有桌面实例' }
if ($otherServers.Count) { throw '发现已有 app-server，拒绝创建第二个实例' }
if ($env:CODEX_APP_SERVER_FORCE_CLI -eq '1') { throw '当前环境强制使用 CLI，不能启用桌面 WebSocket 连接' }
if ($portsInUse.Count) { throw '共享服务端口已占用；启动器不会接管或终止未知服务' }

$mutex = New-Object Threading.Mutex($false, 'Local\CodexMobile.SharedDesktopSession')
$hasMutex = $false
$job = $null
$environmentNames = @('CODEX_APP_SERVER_WS_URL', 'CODEX_APP_SERVER_MODE', 'CODEX_APP_SERVER_URL', 'CODEX_MOBILE_TOKEN',
    'CODEX_HOME', 'HOST', 'PORT', 'NODE_ENV', 'CODEX_MOBILE_HOST_NAME', 'CODEX_MOBILE_SERVE_STATIC')
$savedEnvironment = @{}
foreach ($name in $environmentNames) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
function Wait-HttpReady([string]$Url, [Diagnostics.Process]$Process) {
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        if ($Process.HasExited) { throw "启动进程提前退出：$($Process.ExitCode)" }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
            if ($response.StatusCode -eq 200) { return }
        } catch { }
        Start-Sleep -Milliseconds 150
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "等待服务就绪超时：$Url"
}
try {
    try { $hasMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $hasMutex = $true }
    if (-not $hasMutex) { throw '共享桌面启动器已经运行' }
    Add-Type -Path $jobSource
    $job = New-Object CodexMobile.OwnedProcessJob
    $secret = (Get-Content -LiteralPath $config.TokenFile -Raw).Trim() | ConvertTo-SecureString
    $credential = New-Object Management.Automation.PSCredential('gateway', $secret)
    $env:CODEX_HOME = Join-Path $env:USERPROFILE '.codex'
    $env:CODEX_APP_SERVER_WS_URL = "ws://127.0.0.1:$($config.ServerPort)"
    $server = $job.Start($serverExe, [string[]]@('-c', 'features.code_mode_host=true', 'app-server',
        '--listen', $env:CODEX_APP_SERVER_WS_URL, '--enable', 'realtime_conversation'), $config.RepositoryPath, $false)
    Wait-HttpReady "http://127.0.0.1:$($config.ServerPort)/readyz" $server

    $env:CODEX_APP_SERVER_MODE = 'external'
    $env:CODEX_APP_SERVER_URL = $env:CODEX_APP_SERVER_WS_URL
    $env:CODEX_MOBILE_TOKEN = $credential.GetNetworkCredential().Password
    $env:HOST = '127.0.0.1'
    $env:PORT = [string]$config.GatewayPort
    $env:NODE_ENV = 'production'
    $env:CODEX_MOBILE_HOST_NAME = 'Windows Codex'
    $env:CODEX_MOBILE_SERVE_STATIC = 'true'
    $gateway = $job.Start($nodeExe, [string[]]@($gatewayEntry), $config.RepositoryPath, $false)
    Wait-HttpReady "http://127.0.0.1:$($config.GatewayPort)/" $gateway
    # 桌面应用不需要持有手机网关访问口令。
    [Environment]::SetEnvironmentVariable('CODEX_MOBILE_TOKEN', $null, 'Process')
    $desktop = $job.Start($desktopExe, [string[]]@(), $appDirectory, $true)

    $sshArgs = [string[]]@('-N', '-T', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
        '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
        '-o', 'ConnectTimeout=10', '-i', $config.IdentityFile, '-R',
        "127.0.0.1:$($config.RemotePort):127.0.0.1:$($config.GatewayPort)", $config.SshTarget)
    $tunnel = $null
    $nextTunnelAttempt = [DateTime]::UtcNow
    while (-not $desktop.HasExited) {
        if ($server.HasExited -or $gateway.HasExited) { throw '共享服务已退出，关闭本次桌面会话，避免连接旧服务' }
        if (($null -eq $tunnel -or $tunnel.HasExited) -and [DateTime]::UtcNow -ge $nextTunnelAttempt) {
            if ($null -ne $tunnel) { $tunnel.Dispose() }
            $tunnel = $job.Start($sshExe, $sshArgs, $config.RepositoryPath, $false)
            $nextTunnelAttempt = [DateTime]::UtcNow.AddSeconds(5)
        }
        Start-Sleep -Milliseconds 250
    }
} finally {
    if ($null -ne $job) { $job.Dispose() }
    foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
    if ($hasMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
