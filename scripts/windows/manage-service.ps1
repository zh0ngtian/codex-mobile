param(
    [ValidateSet('install','update-launchers','start','stop','restart','status','ui','check')][string]$Action = 'status',
    [string]$ServiceRoot = (Join-Path $env:LOCALAPPDATA 'CodexMobile\Service'),
    [string]$SharedConfigPath = (Join-Path $env:LOCALAPPDATA 'CodexMobile\shared-session.json'),
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$taskName = 'CodexMobile-Service'
$configPath = Join-Path $ServiceRoot 'service.json'
$powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Save-Json($Path,$Value) { [IO.File]::WriteAllText($Path,($Value | ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false))) }
function Invoke-ServiceControl([string]$Operation,[switch]$Mutating) {
    $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $token = (Get-Content -LiteralPath (Join-Path $ServiceRoot 'control-token') -Raw).Trim()
    $parameters = @{ UseBasicParsing=$true; Uri="http://127.0.0.1:$($config.ServerPort)/__service/$Operation"; Headers=@{Authorization="Bearer $token"}; TimeoutSec=150 }
    if ($Mutating) { $parameters.Method='POST'; $parameters.Body=(@{force=[bool]$Force} | ConvertTo-Json -Compress); $parameters.ContentType='application/json' }
    try { return (Invoke-WebRequest @parameters).Content | ConvertFrom-Json }
    catch { throw '服务操作失败、服务尚未就绪或存在运行中的任务；请查看服务状态' }
}
function Start-Backend {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    if ($task.State -ne 'Running') { Start-ScheduledTask -TaskName $taskName }
}
function Get-QuietLauncher {
    if (-not $script:quietLauncher) {
        $script:quietLauncher = (& $powershell -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File (Join-Path $ServiceRoot 'build-quiet-launcher.ps1') -OutputDirectory $ServiceRoot).Trim()
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $script:quietLauncher -PathType Leaf)) {throw '无终端启动器构建失败'}
    }
    return $script:quietLauncher
}
function New-ServiceShortcut([string]$Path,[string]$ShortcutAction,[string]$Description,[bool]$Visible) {
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($Path)
    if ($Visible) {
        $link.TargetPath=$powershell
        $link.Arguments="-NoProfile -NoExit -ExecutionPolicy RemoteSigned -WindowStyle Normal -File `"$(Join-Path $ServiceRoot 'manage-service.ps1')`" -ServiceRoot `"$ServiceRoot`" -Action $ShortcutAction"
    } else {
        $link.TargetPath=Get-QuietLauncher
        $link.Arguments=$ShortcutAction
    }
    $link.WindowStyle=1
    $link.WorkingDirectory=$ServiceRoot; $link.Description=$Description
    $link.Save()
}
function Remove-LegacyStartupShortcut {
    param([string]$Path = (Join-Path ([Environment]::GetFolderPath('Startup')) 'Codex Desktop.lnk'))
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    $shell=New-Object -ComObject WScript.Shell
    $link=$shell.CreateShortcut($Path)
    $rootPath=[IO.Path]::GetFullPath($ServiceRoot).TrimEnd('\')
    # 只迁移本服务的旧入口；同名的第三方快捷方式不属于本服务。
    if ((Split-Path $link.TargetPath) -eq $rootPath -and
        [IO.Path]::GetFileName($link.TargetPath) -like 'CodexMobileLauncher-*.exe' -and $link.Arguments -eq 'start') {
        Remove-Item -LiteralPath $Path -Force
    }
}

switch ($Action) {
 'install' {
    if ([Environment]::GetEnvironmentVariable('CODEX_APP_SERVER_FORCE_CLI','User') -eq '1') { throw '用户环境强制使用 CLI；独立共享界面需要 WebSocket 模式' }
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existing -and $existing.State -eq 'Running') { throw '后台任务正在运行，拒绝覆盖其文件；先正常停止服务后再安装' }
    $shared = Get-Content -LiteralPath $SharedConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($path in @($shared.IdentityFile,$shared.TokenFile,(Join-Path $shared.RepositoryPath 'npm-dist\server\index.js'))) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw '现有网关配置或构建不完整' }
    }
    $oldTask = Get-ScheduledTask -TaskName 'CodexMobile-SharedDesktop' -ErrorAction SilentlyContinue
    if ($oldTask -and $oldTask.State -eq 'Running') { throw '旧共享桌面任务仍在运行，请完成任务后退出旧共享桌面再安装' }
    New-Item -ItemType Directory -Path $ServiceRoot -Force | Out-Null
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true,$false)
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
    $system = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($system,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
    Set-Acl -LiteralPath $ServiceRoot -AclObject $acl
    $backup = Join-Path $ServiceRoot ('backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Path $backup | Out-Null
    if ($oldTask) { [IO.File]::WriteAllText((Join-Path $backup 'old-task.xml'),(Export-ScheduledTask -TaskName 'CodexMobile-SharedDesktop'),(New-Object Text.UTF8Encoding($true))) }
    Save-Json (Join-Path $backup 'environment.json') @{ CODEX_APP_SERVER_WS_URL=[Environment]::GetEnvironmentVariable('CODEX_APP_SERVER_WS_URL','User'); OldTaskEnabled=($oldTask -and $oldTask.Settings.Enabled) }
    foreach($name in @('OwnedProcessJob.cs','resolve-desktop.ps1','run-owned-process.ps1','start-independent-service.ps1','manage-service.ps1','QuietLauncher.cs','build-quiet-launcher.ps1')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $ServiceRoot $name) -Force
    }
    $moduleRoot = Join-Path $ServiceRoot 'service'
    New-Item -ItemType Directory -Path $moduleRoot -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'service') -Filter '*.mjs' | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $moduleRoot $_.Name) -Force }
    # 只复制已安装的 ws 运行依赖，不在用户电脑临时安装或下载依赖。
    $dependencyRoot = (& node.exe -p "require('path').dirname(require.resolve('ws/package.json'))").Trim()
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $dependencyRoot -PathType Container)) { throw '找不到已安装的 ws 依赖' }
    $vendorRoot = Join-Path $ServiceRoot 'node_modules\ws'
    New-Item -ItemType Directory -Path $vendorRoot -Force | Out-Null
    Get-ChildItem -LiteralPath $dependencyRoot -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $vendorRoot $_.Name) -Recurse -Force }
    $controlPath=Join-Path $ServiceRoot 'control-token'
    if (-not (Test-Path -LiteralPath $controlPath)) {
        $bytes=New-Object byte[] 32; $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        [IO.File]::WriteAllText($controlPath,([BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant()),(New-Object Text.UTF8Encoding($false)))
    }
    $codexStateDirectory = [Environment]::GetEnvironmentVariable('CODEX_HOME','User')
    if (-not $codexStateDirectory) { $codexStateDirectory=Join-Path $env:USERPROFILE '.codex' }
    Save-Json $configPath @{ RepositoryPath=$shared.RepositoryPath; ServerPort=[int]$shared.ServerPort; PrivateServerPort=18768; GatewayPort=[int]$shared.GatewayPort;
        RemotePort=[int]$shared.RemotePort; ExternalUrl=$shared.ExternalUrl; IdentityFile=$shared.IdentityFile; TokenFile=$shared.TokenFile; SshTarget=$shared.SshTarget; CodexHome=$codexStateDirectory }
    $principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
    $taskAction=New-ScheduledTaskAction -Execute (Get-QuietLauncher) -Argument 'backend' -WorkingDirectory $ServiceRoot
    $trigger=New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
    $settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Settings $settings -Principal $principal -Description 'Independent Codex app-server, mobile gateway and idle version alignment; UI has a separate lifetime.' -Force | Out-Null
    [Environment]::SetEnvironmentVariable('CODEX_APP_SERVER_WS_URL',"ws://127.0.0.1:$($shared.ServerPort)",'User')
    $desktop=[Environment]::GetFolderPath('Desktop')
    foreach($name in @('打开 Codex.lnk','重启 Codex 服务.lnk','Codex 服务状态.lnk','Codex 共享服务.lnk')) { $path=Join-Path $desktop $name; if(Test-Path -LiteralPath $path){Copy-Item -LiteralPath $path -Destination (Join-Path $backup $name)} }
    New-ServiceShortcut (Join-Path $desktop '打开 Codex.lnk') 'ui' '打开界面，连接独立后台服务' $false
    New-ServiceShortcut (Join-Path $desktop '重启 Codex 服务.lnk') 'restart' '空闲时重启服务，自动监控作为默认方式' $true
    New-ServiceShortcut (Join-Path $desktop 'Codex 服务状态.lnk') 'status' '查看当前版本和等待更新状态' $true
    if(Test-Path -LiteralPath (Join-Path $desktop 'Codex 共享服务.lnk')) { New-ServiceShortcut (Join-Path $desktop 'Codex 共享服务.lnk') 'ui' '打开界面，连接独立后台服务' $false }
    $startup=Join-Path ([Environment]::GetFolderPath('Startup')) 'Codex Desktop.lnk'
    if(Test-Path -LiteralPath $startup) { Copy-Item -LiteralPath $startup -Destination (Join-Path $backup 'startup.lnk') }
    Remove-LegacyStartupShortcut
    if($oldTask){Disable-ScheduledTask -TaskName 'CodexMobile-SharedDesktop' | Out-Null}
    Start-Backend
    [pscustomobject]@{Installed=$true;Task=$taskName;ServiceRoot=$ServiceRoot;Backup=$backup;NextStep='首次切换时退出旧 Codex，然后用打开 Codex快捷方式启动界面'} | ConvertTo-Json
 }
 'update-launchers' {
    if (-not (Test-Path -LiteralPath $configPath)) {throw '独立服务尚未安装'}
    $task=Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    $rootPath=[IO.Path]::GetFullPath($ServiceRoot).TrimEnd('\')
    $taskExecutableRoot=Split-Path $task.Actions.Execute
    if ($taskExecutableRoot -ne $rootPath -and -not $task.Actions.Arguments.Contains($configPath)) {throw '计划任务指向其他服务目录，拒绝更改'}
    $backup=Join-Path $ServiceRoot ('launcher-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Path $backup | Out-Null
    [IO.File]::WriteAllText((Join-Path $backup 'task.xml'),(Export-ScheduledTask -TaskName $taskName),(New-Object Text.UTF8Encoding($true)))
    $desktop=[Environment]::GetFolderPath('Desktop')
    foreach($name in @('打开 Codex.lnk','Codex 共享服务.lnk')) {
        $path=Join-Path $desktop $name
        if(Test-Path -LiteralPath $path){Copy-Item -LiteralPath $path -Destination (Join-Path $backup $name)}
    }
    $startup=Join-Path ([Environment]::GetFolderPath('Startup')) 'Codex Desktop.lnk'
    if(Test-Path -LiteralPath $startup){Copy-Item -LiteralPath $startup -Destination (Join-Path $backup 'startup.lnk')}
    foreach($name in @('manage-service.ps1','QuietLauncher.cs','build-quiet-launcher.ps1')) {
        $source=Join-Path $PSScriptRoot $name; $destination=Join-Path $ServiceRoot $name
        if([IO.Path]::GetFullPath($source) -ne [IO.Path]::GetFullPath($destination)) {Copy-Item -LiteralPath $source -Destination $destination -Force}
    }
    $launcher=Get-QuietLauncher
    New-ServiceShortcut (Join-Path $desktop '打开 Codex.lnk') 'ui' '无终端打开界面，连接独立后台服务' $false
    if(Test-Path -LiteralPath (Join-Path $desktop 'Codex 共享服务.lnk')) {New-ServiceShortcut (Join-Path $desktop 'Codex 共享服务.lnk') 'ui' '无终端打开界面，连接独立后台服务' $false}
    Remove-LegacyStartupShortcut
    # 更新后续启动入口；不停止或重启当前运行实例。
    $taskAction=New-ScheduledTaskAction -Execute $launcher -Argument 'backend' -WorkingDirectory $ServiceRoot
    Set-ScheduledTask -TaskName $taskName -Action $taskAction | Out-Null
    [pscustomobject]@{Updated=$true;Launcher=$launcher;Backup=$backup;BackendRestarted=$false} | ConvertTo-Json
 }
 'check' {
    $descriptor = (& $powershell -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File (Join-Path $PSScriptRoot 'resolve-desktop.ps1')) | ConvertFrom-Json
    [pscustomobject]@{DesktopPackage=$descriptor.packageVersion;AppServer=$descriptor.version;Installed=(Test-Path -LiteralPath $configPath);TaskRegistered=[bool](Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)} | ConvertTo-Json
 }
 'start' { Start-Backend; Write-Output '后台任务已启动，现有服务器未退出时会等待，不终止当前任务' }
 'status' {
    try { Invoke-ServiceControl 'status' | ConvertTo-Json -Depth 5 }
    catch { $path=Join-Path $ServiceRoot 'status.json'; if(Test-Path -LiteralPath $path){Get-Content -LiteralPath $path -Raw -Encoding UTF8}else{Write-Output '服务尚未启动'} }
 }
 'restart' { Invoke-ServiceControl 'restart' -Mutating | ConvertTo-Json -Depth 5 }
 'stop' { Invoke-ServiceControl 'stop' -Mutating | ConvertTo-Json -Depth 5 }
 'ui' {
    Start-Backend
    $config=Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $deadline=[DateTime]::UtcNow.AddSeconds(90); $ready=$false
    do {
        try { $status=Invoke-ServiceControl 'status'; if($status.ready){$ready=$true;break} } catch { }
        Start-Sleep -Milliseconds 500
    } while([DateTime]::UtcNow -lt $deadline)
    if(-not $ready){throw '后台尚未就绪；首次使用请先完全退出旧 Codex，并查看服务状态'}
    $descriptor=(& $powershell -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File (Join-Path $ServiceRoot 'resolve-desktop.ps1') -SkipVersion) | ConvertFrom-Json
    $env:CODEX_APP_SERVER_WS_URL="ws://127.0.0.1:$($config.ServerPort)"
    [Environment]::SetEnvironmentVariable('CODEX_MOBILE_TOKEN',$null,'Process')
    Start-Process -FilePath $descriptor.desktopExecutable -WorkingDirectory (Split-Path $descriptor.desktopExecutable) -WindowStyle Normal | Out-Null
 }
}
