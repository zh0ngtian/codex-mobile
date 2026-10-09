$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '..\scripts\windows\start-shared-session.ps1'
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Launcher syntax error' }
# Execute only the real token-reading statement, never the process launcher.
$reader = $ast.Find({ param($node)
    $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$secret'
}, $true)
if ($null -eq $reader) { throw 'Token reader not found' }
$temporaryToken = [IO.Path]::GetTempFileName()
try {
    $config = [pscustomobject]@{ TokenFile = $temporaryToken }
    $expected = 'test-only-token-not-a-real-credential'
    $encrypted = ConvertTo-SecureString $expected -AsPlainText -Force | ConvertFrom-SecureString
    foreach ($suffix in @('', ([string][char]13 + [char]10), ([string][char]10), '  ')) {
        [IO.File]::WriteAllText($temporaryToken, ($encrypted + $suffix), [Text.Encoding]::ASCII)
        Invoke-Expression $reader.Extent.Text
        $credential = New-Object Management.Automation.PSCredential('test', $secret)
        if ($credential.GetNetworkCredential().Password -cne $expected) { throw 'Token changed during decoding' }
        $secret.Dispose()
    }
    [IO.File]::WriteAllText($temporaryToken, 'invalid-encrypted-token', [Text.Encoding]::ASCII)
    $rejected = $false
    try { Invoke-Expression $reader.Extent.Text } catch { $rejected = $true }
    if (-not $rejected) { throw 'Corrupt token should be rejected' }
    Write-Output 'PASS: newline variants decode unchanged; corrupt token rejected.'
} finally {
    Remove-Item -LiteralPath $temporaryToken -Force
}
