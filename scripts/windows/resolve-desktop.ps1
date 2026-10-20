param([switch]$SkipVersion)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$package = Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1
if (-not $package) { throw '未找到当前用户安装的 Codex' }
$appDirectory = Join-Path $package.InstallLocation 'app'
$resources = Join-Path $appDirectory 'resources'
$executable = Join-Path $resources 'codex.exe'
$desktop = Join-Path $appDirectory 'ChatGPT.exe'
foreach ($path in @($executable, $desktop)) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw '当前 Codex 安装包不完整' } }
$version = if ($SkipVersion) { $null } else { (& $executable --version | Out-String).Trim() }
if (-not $SkipVersion -and $LASTEXITCODE -ne 0) { throw '读取 app-server 版本失败' }
[pscustomobject]@{ packageVersion=$package.Version.ToString(); resourcesDirectory=$resources; desktopExecutable=$desktop; version=$version } | ConvertTo-Json -Compress
