param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'QuietLauncher.cs'
$fingerprint = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.Substring(0,16).ToLowerInvariant()
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$output = Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) ("CodexMobileLauncher-$fingerprint.exe")
if (-not (Test-Path -LiteralPath $output -PathType Leaf)) {
    $temporary = Join-Path $OutputDirectory ([Guid]::NewGuid().ToString() + '.exe')
    try {
        Add-Type -Path $source -OutputAssembly $temporary -OutputType WindowsApplication -ReferencedAssemblies @('System.dll','System.Windows.Forms.dll')
        Move-Item -LiteralPath $temporary -Destination $output
    } finally {
        if (Test-Path -LiteralPath $temporary) {Remove-Item -LiteralPath $temporary}
    }
}
Write-Output $output
