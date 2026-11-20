# Offline checks for the launcher; no model download or installation required.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path $PSScriptRoot -Parent
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'start-local.ps1'), [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { throw ($errors | Out-String) }
foreach ($function in $ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst]}, $false)) {
    Invoke-Expression $function.Extent.Text
}
$runtime = Join-Path $root ('.runtime\test-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $runtime -Force
$statePath = Join-Path $runtime 'processes.json'
$started = New-Object System.Collections.ArrayList
$listener = $null
try {
    $file = Join-Path $runtime 'fixture.bin'
    [IO.File]::WriteAllText($file, 'test fixture')
    $spec = [pscustomobject]@{sha256=(Get-FileHash $file).Hash; url='https://invalid.example/test'}
    Get-VerifiedFile $spec $file
    if (-not (Test-Path "$file.verified")) { throw 'Missing verification stamp' }
    Get-VerifiedFile $spec $file
    Write-Host 'PASS Existing valid files are verified and reused offline'
    [IO.File]::WriteAllText($file, 'corrupt')
    $rejected = $false
    try { Get-VerifiedFile $spec $file } catch { $rejected = $true }
    if (-not $rejected) { throw 'Corrupt file was accepted' }
    Write-Host 'PASS Changed/corrupt files are rejected'
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $rejected = $false
    try { Assert-FreePort $listener.LocalEndpoint.Port } catch { $rejected = $true }
    if (-not $rejected) { throw 'Busy port was accepted' }
    $port = $listener.LocalEndpoint.Port
    $listener.Stop()
    Assert-FreePort $port
    Write-Host 'PASS Port conflicts fail clearly; free ports are accepted'
    $child = Start-Owned (Join-Path $PSHOME 'powershell.exe') '-NoProfile -Command Start-Sleep -Seconds 120' 'test-child'
    $child2 = Start-Owned (Join-Path $PSHOME 'powershell.exe') '-NoProfile -Command Start-Sleep -Seconds 120' 'test-child2'
    if (@(Read-Processes).Count -ne 2) { throw 'Owned processes were not recognized' }
    $entry = Get-Content $statePath -Raw | ConvertFrom-Json
    $entry[0].start = '0'
    ConvertTo-Json -InputObject @($entry) | Set-Content $statePath
    if (@(Read-Processes).Count -ne 1) { throw 'Recycled PID was accepted' }
    Save-State
    Stop-Owned
    if (Get-Process -Id $child.Id -ErrorAction SilentlyContinue) { throw 'Owned process was not stopped' }
    if (Get-Process -Id $child2.Id -ErrorAction SilentlyContinue) { throw 'Second owned process was not stopped' }
    Write-Host 'PASS Process ownership is checked; stop affects only owned processes'
} finally {
    if ($listener) { $listener.Stop() }
    if (Test-Path $statePath) { Stop-Owned }
    # This directory was created above, inside the workspace, with a unique name.
    $expectedParent = [IO.Path]::GetFullPath((Join-Path $root '.runtime'))
    if ((Split-Path ([IO.Path]::GetFullPath($runtime)) -Parent) -eq $expectedParent) {
        Remove-Item -LiteralPath $runtime -Recurse -Force
    }
}
