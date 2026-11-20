param([switch]$Stop, [switch]$ModelOnly, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $root '.runtime'
$null = New-Item -ItemType Directory -Force $runtime
Set-Location -LiteralPath $root
$null = New-Item -ItemType Directory -Force (Join-Path $root 'models')
$manifest = Get-Content (Join-Path $PSScriptRoot 'local-runtime.json') -Raw | ConvertFrom-Json
$statePath = Join-Path $runtime 'processes.json'
$lock = $null
$started = New-Object System.Collections.ArrayList

function Save-State {
    ConvertTo-Json -InputObject $script:started.ToArray() | Set-Content $script:statePath -Encoding UTF8
}
function Read-Processes {
    if (Test-Path $script:statePath) {
        $entries = Get-Content $script:statePath -Raw | ConvertFrom-Json
        foreach ($entry in $entries) {
            $process = Get-Process -Id $entry.id -ErrorAction SilentlyContinue
            # Never stop an unrelated process if Windows has recycled a PID.
            if ($process -and $process.StartTime.ToUniversalTime().Ticks.ToString() -eq $entry.start -and $process.Path -eq $entry.path) { $process }
        }
    }
}
function Stop-Owned {
    foreach ($process in @(Read-Processes)) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
    if (Test-Path $script:statePath) { Remove-Item -LiteralPath $script:statePath }
}
function Get-Json($url) {
    $request = [System.Net.HttpWebRequest]::Create($url)
    $request.Proxy = $null
    $request.Timeout = 2000
    $response = $null
    try {
        $response = $request.GetResponse()
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        try { return ($reader.ReadToEnd() | ConvertFrom-Json) } finally { $reader.Dispose() }
    } finally { if ($response) { $response.Dispose() } }
}
function Test-Model {
    try {
        if ((Get-Json 'http://127.0.0.1:8080/health').status -ne 'ok') { return $false }
        return (@((Get-Json 'http://127.0.0.1:8080/v1/models').data | Where-Object { $_.id -eq 'kh-way-local' }).Count -gt 0)
    } catch { return $false }
}
function Assert-FreePort([int]$port) {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $port)
    try { $listener.Start() } catch { throw "Порт $port занят. Закройте другое приложение или выполните stop.cmd." }
    finally { $listener.Stop() }
}
function Get-VerifiedFile($spec, $destination) {
    $stamp = "$destination.verified"
    if (Test-Path $destination) {
        $file = Get-Item $destination
        $signature = "$($spec.sha256):$($file.Length):$($file.LastWriteTimeUtc.Ticks)"
        if ((Test-Path $stamp) -and (Get-Content $stamp -Raw).Trim() -eq $signature) { return }
        Write-Host "Проверка: $($file.Name)"
        if ((Get-FileHash $destination -Algorithm SHA256).Hash -ieq $spec.sha256) {
            Set-Content $stamp $signature
            return
        }
        throw "Поврежден файл $destination. Удалите его и повторите запуск."
    }
    $partial = "$destination.part"
    Write-Host "Загрузка: $(Split-Path $destination -Leaf) (при обрыве повторите запуск)"
    $urls = @($spec.url)
    if ($spec.PSObject.Properties.Name -contains 'fallback') { $urls += $spec.fallback }
    $ok = $false
    foreach ($url in $urls) {
        & curl.exe --fail --location --retry 3 --connect-timeout 20 --speed-time 60 --speed-limit 1024 --continue-at - --output $partial $url
        if ($LASTEXITCODE -eq 0) { $ok = $true; break }
    }
    if (-not $ok) { throw 'Не удалось скачать файл. Проверьте интернет и повторите запуск; загрузка продолжится.' }
    if ((Get-FileHash $partial -Algorithm SHA256).Hash -ine $spec.sha256) {
        Remove-Item -LiteralPath $partial
        throw 'Контрольная сумма не совпала. Повторите запуск для новой загрузки.'
    }
    Move-Item -LiteralPath $partial -Destination $destination
    $file = Get-Item $destination
    Set-Content $stamp "$($spec.sha256):$($file.Length):$($file.LastWriteTimeUtc.Ticks)"
}
function Install-Zip($name, $executable) {
    $folder = Join-Path $script:runtime $name
    $target = Join-Path $folder $executable
    if (-not (Test-Path $target) -or -not (Test-Path (Join-Path $folder '.installed')) -or (Get-Content (Join-Path $folder '.installed') -Raw).Trim() -ne $script:manifest.$name.sha256) {
        $zip = Join-Path $script:runtime "$name.zip"
        Get-VerifiedFile $script:manifest.$name $zip
        Expand-Archive -LiteralPath $zip -DestinationPath $folder -Force
        if (-not (Test-Path $target)) { throw "В архиве $name нет $executable." }
        Set-Content (Join-Path $folder '.installed') $script:manifest.$name.sha256
    }
    return $target
}
function Start-Owned($exe, $arguments, $name) {
    $process = Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $script:root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $script:runtime "$name.out.log") -RedirectStandardError (Join-Path $script:runtime "$name.err.log")
    $null = $script:started.Add(@{id=$process.Id; start=$process.StartTime.ToUniversalTime().Ticks.ToString(); path=[IO.Path]::GetFullPath($exe)})
    Save-State
    return $process
}
function Wait-Ready($url, $process, [int]$seconds = 30) {
    $deadline = (Get-Date).AddSeconds($seconds)
    do {
        $process.Refresh()
        if ($process.HasExited) { throw "Процесс завершился. Журналы: $script:runtime\*.err.log. Возможно, нужен Visual C++ Redistributable x64: https://aka.ms/vs/17/release/vc_redist.x64.exe" }
        try { $null = Get-Json $url; return } catch {}
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "Сервис не успел запуститься: $url. Журналы: $script:runtime"
}

function Open-Site {
    if (-not $script:NoBrowser) {
        Start-Process 'http://127.0.0.1:8090/'
        Start-Process 'http://127.0.0.1:8090/admin/'
    }
}
function Test-Backend {
    try { return ((Get-Json 'http://127.0.0.1:8090/api/health').service -eq 'gis-ekb-admin') }
    catch { return $false }
}
function Install-Backend {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $node = $null
    if ($nodeCommand) {
        $version = & $nodeCommand.Source -p "Number(process.versions.node.split('.')[0]) >= 22 && (Number(process.versions.node.split('.')[0]) > 22 || Number(process.versions.node.split('.')[1]) >= 15)"
        if ($LASTEXITCODE -eq 0 -and $version -eq 'true') { $node = $nodeCommand.Source }
    }
    if (-not $node) { $node = Install-Zip 'node' 'node-v22.15.1-win-x64\node.exe' }
    $nodeFolder = Split-Path $node -Parent
    $env:PATH = "$nodeFolder;$env:PATH"
    $npm = Join-Path $nodeFolder 'npm.cmd'
    $stamp = Join-Path $script:runtime 'npm-lock.sha256'
    $hash = (Get-FileHash (Join-Path $script:root 'package-lock.json')).Hash
    $valid = $false
    if ((Test-Path $stamp) -and (Get-Content $stamp -Raw).Trim() -eq $hash) {
        & $node --input-type=module -e "await Promise.all(['xlsx','sharp','geotiff','proj4','fflate','fast-xml-parser'].map(name=>import(name)))" 2>$null
        $valid = $LASTEXITCODE -eq 0
    } elseif (Test-Path (Join-Path $script:root 'node_modules')) {
        & $npm ls --omit=dev --depth=0 *> (Join-Path $script:runtime 'npm-check.log')
        $valid = $LASTEXITCODE -eq 0
    }
    if (-not $valid) {
        Write-Host 'Installing administration dependencies...'
        & $npm ci --omit=dev --no-audit --no-fund | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check the connection and run start.cmd again.' }
    }
    Set-Content $stamp $hash
    & $node (Join-Path $script:root 'tools/configure-local.mjs') | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Could not configure the local admin key.' }
    & $node (Join-Path $script:root 'server/migrate.js') | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Initial data import failed. See the error above.' }
    return $node
}

try {
    try { $lock = [System.IO.File]::Open((Join-Path $runtime 'launcher.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { throw 'Другой запуск уже выполняется. Дождитесь его завершения.' }
    if ($Stop) { Stop-Owned; Write-Host 'Сайт и модель остановлены.'; exit 0 }
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Нужна 64-разрядная Windows 10/11 (x64).' }
    if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { throw 'Не найден curl.exe. Нужна Windows 10/11 с системным curl.' }
    $existing = @(Read-Processes)
    if ($existing.Count -gt 0) {
        if (-not $ModelOnly -and $existing.Count -eq 1 -and (Test-Backend)) {
            Open-Site
            Write-Host 'Сайт уже работает: http://127.0.0.1:8090/'
            exit 0
        }
        if ($ModelOnly -and (Test-Model)) { Write-Host 'Модель уже готова.'; exit 0 }
        Stop-Owned
    }
    if ($ModelOnly) {
        if (-not (Test-Model)) {
            Assert-FreePort 8080
            $server = Install-Zip 'llama' 'llama-server.exe'
            $model = Join-Path $root 'models\qwen3-4b-iq3_m.gguf'
            Get-VerifiedFile $manifest.model $model
            Write-Host 'Загрузка модели в память (на CPU может занять несколько минут)...'
            $modelProcess = Start-Owned $server "--model `"$model`" --alias kh-way-local --host 127.0.0.1 --port 8080 --ctx-size 4096 --threads 4 --parallel 1 --no-webui --jinja" 'model'
            Wait-Ready 'http://127.0.0.1:8080/health' $modelProcess 240
            if (-not (Test-Model)) { throw 'Сервер не предоставил модель kh-way-local.' }
        }
        Write-Host 'Модель готова: http://127.0.0.1:8080/'
    } else {
        Assert-FreePort 8090
        $node = Install-Backend
        $env:HOST = '127.0.0.1'
        $env:PORT = '8090'
        $backend = Start-Owned $node ('"' + (Join-Path $root 'server/server.js') + '"') 'backend'
        Wait-Ready 'http://127.0.0.1:8090/api/health' $backend
        Open-Site
        Write-Host 'Готово! Сайт: http://127.0.0.1:8090/'
    }
    Write-Host 'Окно можно закрыть. Для остановки запустите stop.cmd.'
} catch {
    if ($started.Count -gt 0) { Stop-Owned }
    Write-Host "Ошибка: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally { if ($lock) { $lock.Dispose() } }
