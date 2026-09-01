[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$utf8Encoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8Encoding
[Console]::OutputEncoding = $utf8Encoding
$OutputEncoding = $utf8Encoding

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDirectory = Join-Path $projectRoot ".runtime"
$backendDirectory = Join-Path $projectRoot "backend"
$webDirectory = Join-Path $projectRoot "web"
$electronDirectory = Join-Path $projectRoot "electron"
$virtualEnvironment = Join-Path $projectRoot ".venv"
$pythonExecutable = Join-Path $virtualEnvironment "Scripts\python.exe"
$npmExecutable = (Get-Command npm.cmd -ErrorAction Stop).Source
$managedProcesses = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
$databaseStarted = $false

function Write-Step([string]$message) {
    Write-Host "[canvas] $message" -ForegroundColor Cyan
}

function Test-Command([string]$name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "Не найдена команда '$name'. Установите её и повторите запуск."
    }
}

function Test-Port([int]$port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $connection = $client.ConnectAsync("127.0.0.1", $port)
        if (-not $connection.Wait(350)) {
            return $false
        }
        return $client.Connected
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Wait-Http([string]$url, [string]$name, [int]$timeoutSeconds = 90) {
    $deadline = [DateTime]::UtcNow.AddSeconds($timeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
                return
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }
    throw "$name не запустился за $timeoutSeconds секунд. Проверьте логи в $runtimeDirectory."
}

function Start-ManagedProcess(
    [string]$name,
    [string]$filePath,
    [string[]]$arguments,
    [string]$workingDirectory,
    [bool]$hidden = $true
) {
    $stdout = Join-Path $runtimeDirectory "$name.log"
    $stderr = Join-Path $runtimeDirectory "$name.error.log"
    $startParameters = @{
        FilePath = $filePath
        ArgumentList = $arguments
        WorkingDirectory = $workingDirectory
        RedirectStandardOutput = $stdout
        RedirectStandardError = $stderr
        PassThru = $true
    }
    if ($hidden) {
        $startParameters.WindowStyle = "Hidden"
    }
    $process = Start-Process @startParameters
    $managedProcesses.Add($process)
    return $process
}

function Stop-ManagedProcesses {
    foreach ($process in $managedProcesses) {
        if ($null -eq $process -or $process.HasExited) {
            continue
        }
        & taskkill.exe /PID $process.Id /T /F *> $null
    }
}

function Test-DockerEngine {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = "docker.exe"
    $startInfo.Arguments = "info"
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        [void]$process.Start()
        [void]$process.StandardOutput.ReadToEnd()
        [void]$process.StandardError.ReadToEnd()
        $process.WaitForExit()
        return $process.ExitCode -eq 0
    }
    catch {
        return $false
    }
    finally {
        $process.Dispose()
    }
}

function Wait-Docker {
    if (Test-DockerEngine) {
        return
    }

    $dockerDesktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
    if (-not (Test-Path -LiteralPath $dockerDesktop)) {
        throw "Docker Desktop не запущен и не найден в стандартной папке."
    }

    Write-Step "Запускаю Docker Desktop"
    Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Seconds 2
        if (Test-DockerEngine) {
            return
        }
    }
    throw "Docker Desktop не запустился за 120 секунд."
}

Set-Location $projectRoot
New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null

try {
    Test-Command "python.exe"
    Test-Command "npm.cmd"
    Test-Command "docker.exe"

    if (Test-Port 8000) {
        throw "Порт 8000 уже занят. Остановите старый API и повторите запуск."
    }
    if (Test-Port 3000) {
        throw "Порт 3000 уже занят. Остановите старый браузерный клиент и повторите запуск."
    }

    $environmentFile = Join-Path $projectRoot ".env"
    if (-not (Test-Path -LiteralPath $environmentFile)) {
        Copy-Item -LiteralPath (Join-Path $projectRoot ".env.example") -Destination $environmentFile
        $jwtSecret = ([Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N"))
        $environmentContent = Get-Content -Raw -LiteralPath $environmentFile
        $environmentContent = $environmentContent -replace "(?m)^JWT_SECRET=.*$", "JWT_SECRET=$jwtSecret"
        Set-Content -LiteralPath $environmentFile -Value $environmentContent -Encoding UTF8
        Write-Step "Создан .env"
    }

    Write-Step "Проверяю зависимости Python"
    if (-not (Test-Path -LiteralPath $pythonExecutable)) {
        & python.exe -m venv $virtualEnvironment
        if ($LASTEXITCODE -ne 0) {
            throw "Не удалось создать Python virtual environment."
        }
    }
    & $pythonExecutable -m pip install --disable-pip-version-check -q -r (Join-Path $backendDirectory "requirements-dev.txt")
    if ($LASTEXITCODE -ne 0) {
        throw "Не удалось установить Python-зависимости."
    }

    Write-Step "Проверяю зависимости браузерного клиента"
    & $npmExecutable install --no-audit --no-fund --loglevel error --prefix $webDirectory
    if ($LASTEXITCODE -ne 0) {
        throw "Не удалось установить зависимости браузерного клиента."
    }

    Write-Step "Проверяю зависимости Windows-клиента"
    & $npmExecutable install --no-audit --no-fund --loglevel error --prefix $electronDirectory
    if ($LASTEXITCODE -ne 0) {
        throw "Не удалось установить зависимости Windows-клиента."
    }

    Wait-Docker
    Write-Step "Запускаю PostgreSQL"
    & docker.exe compose up -d --wait postgres
    if ($LASTEXITCODE -ne 0) {
        throw "Не удалось запустить PostgreSQL."
    }
    $databaseStarted = $true

    Write-Step "Запускаю API"
    $api = Start-ManagedProcess `
        -name "api" `
        -filePath $pythonExecutable `
        -arguments @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000") `
        -workingDirectory $backendDirectory
    Wait-Http "http://127.0.0.1:8000/health" "API"

    Write-Step "Запускаю браузерный клиент"
    $web = Start-ManagedProcess `
        -name "web" `
        -filePath $npmExecutable `
        -arguments @("run", "dev") `
        -workingDirectory $webDirectory
    Wait-Http "http://127.0.0.1:3000" "Браузерный клиент" 120

    Write-Step "Запускаю Windows-клиент"
    $electronExecutable = Join-Path $electronDirectory "node_modules\electron\dist\electron.exe"
    if (-not (Test-Path -LiteralPath $electronExecutable)) {
        $npxExecutable = (Get-Command npx.cmd -ErrorAction Stop).Source
        Push-Location $electronDirectory
        try {
            & $npxExecutable install-electron --no
            if ($LASTEXITCODE -ne 0) {
                throw "Не удалось скачать Electron runtime."
            }
        }
        finally {
            Pop-Location
        }
    }
    $electron = Start-ManagedProcess `
        -name "electron" `
        -filePath $electronExecutable `
        -arguments @(".") `
        -workingDirectory $electronDirectory `
        -hidden $false

    Start-Process "http://localhost:3000"
    Write-Host ""
    Write-Host "Всё запущено. Для остановки нажмите Ctrl+C." -ForegroundColor Green
    Write-Host "Логи: $runtimeDirectory" -ForegroundColor DarkGray

    while ($true) {
        Start-Sleep -Seconds 1
        if ($api.HasExited) {
            throw "API неожиданно завершился."
        }
        if ($web.HasExited) {
            throw "Браузерный клиент неожиданно завершился."
        }
    }
}
catch [System.Management.Automation.PipelineStoppedException] {
    # Ctrl+C — штатное завершение.
}
catch {
    Write-Host ""
    Write-Host $_.Exception.Message -ForegroundColor Red
    if (Test-Path -LiteralPath $runtimeDirectory) {
        Write-Host "Логи: $runtimeDirectory" -ForegroundColor DarkGray
    }
    exit 1
}
finally {
    Write-Step "Останавливаю приложения"
    Stop-ManagedProcesses
    if ($databaseStarted) {
        & docker.exe compose stop postgres *> $null
    }
    Set-Location $projectRoot
}
