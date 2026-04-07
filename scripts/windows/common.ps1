$ErrorActionPreference = "Stop"

$DittoDefaultBackendPort = 8000
$DittoDefaultFrontendPort = 5173
$DittoDefaultOllamaModel = "qwen3.5:9b"
$DittoDefaultOllamaBaseUrl = "http://127.0.0.1:11434"
$DittoVoskModelPublicUrl = "/models/vosk-model-small-it-0.22.tar.gz"
$DittoVoskModelArchiveName = "vosk-model-small-it-0.22.tar.gz"
$DittoWindowsScriptDir = $PSScriptRoot

function Write-DittoInfo {
    param([string]$Message)
    Write-Host "[INFO] $Message"
}

function Write-DittoOk {
    param([string]$Message)
    Write-Host "[OK] $Message"
}

function Write-DittoWarn {
    param([string]$Message)
    Write-Host "[AVVISO] $Message"
}

function Write-DittoError {
    param([string]$Message)
    Write-Host "[ERRORE] $Message"
}

function Write-DittoStep {
    param([string]$Message)
    Write-Host ""
    Write-Host $Message
}

function Get-DittoRoot {
    return (Resolve-Path (Join-Path $DittoWindowsScriptDir "..\..")).Path
}

function Test-DittoCommand {
    param([Parameter(Mandatory=$true)][string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Update-DittoPath {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = @($machinePath, $userPath, $env:Path) -join ";"
}

function Invoke-DittoTool {
    param(
        [Parameter(Mandatory=$true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = ""
    )

    $oldLocation = (Get-Location).Path
    $oldErrorActionPreference = $ErrorActionPreference
    try {
        if ($WorkingDirectory) {
            Set-Location $WorkingDirectory
        }
        $ErrorActionPreference = "Continue"
        $output = @(& $FilePath @Arguments 2>&1 | ForEach-Object { $_.ToString() })
        $exitCode = $LASTEXITCODE
        if ($output) {
            $output | ForEach-Object { Write-Host $_ }
        }
        return $exitCode
    } finally {
        $ErrorActionPreference = $oldErrorActionPreference
        Set-Location $oldLocation
    }
}

function Invoke-DittoToolChecked {
    param(
        [Parameter(Mandatory=$true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = "",
        [string]$FailureMessage = "Comando fallito."
    )

    $exitCode = Invoke-DittoTool -FilePath $FilePath -Arguments $Arguments -WorkingDirectory $WorkingDirectory
    if ($exitCode -ne 0) {
        throw "$FailureMessage Exit code: $exitCode"
    }
}

function Invoke-DittoDocker {
    param(
        [Parameter(Mandatory=$true)][string[]]$Arguments,
        [string]$WorkingDirectory = "",
        [string]$FailureMessage = "Comando Docker fallito.",
        [switch]$AllowFailure
    )

    Use-DittoWritableDockerConfig
    $result = Invoke-DittoCapturedTool -FilePath "docker" -Arguments $Arguments -WorkingDirectory $WorkingDirectory
    if ($result.ExitCode -eq 0) {
        if ($result.Output) {
            $result.Output | ForEach-Object { Write-Host $_ }
        }
        if ($AllowFailure) {
            return 0
        }
        return
    }

    if (Test-DittoDockerEngineError -Output $result.Output) {
        Write-DittoWarn "Docker Desktop non ha ancora esposto il motore Linux."
        Start-DittoDockerDesktop | Out-Null
        if (Wait-DittoDocker -TimeoutSeconds 300) {
            $result = Invoke-DittoCapturedTool -FilePath "docker" -Arguments $Arguments -WorkingDirectory $WorkingDirectory
            if ($result.ExitCode -eq 0) {
                if ($result.Output) {
                    $result.Output | ForEach-Object { Write-Host $_ }
                }
                if ($AllowFailure) {
                    return 0
                }
                return
            }
        }
    }

    if ($AllowFailure) {
        return $result.ExitCode
    }

    throw "$(Get-DittoDockerFailureMessage -FailureMessage $FailureMessage -Output $result.Output) Exit code: $($result.ExitCode)"
}

function Invoke-DittoCapturedTool {
    param(
        [Parameter(Mandatory=$true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = ""
    )

    $oldLocation = (Get-Location).Path
    $oldErrorActionPreference = $ErrorActionPreference
    try {
        if ($WorkingDirectory) {
            Set-Location $WorkingDirectory
        }
        $ErrorActionPreference = "Continue"
        $output = @(& $FilePath @Arguments 2>&1 | ForEach-Object { $_.ToString() })
        return @{ ExitCode = $LASTEXITCODE; Output = $output }
    } finally {
        $ErrorActionPreference = $oldErrorActionPreference
        Set-Location $oldLocation
    }
}

function Test-DittoDockerEngineError {
    param([string[]]$Output = @())

    $text = ($Output -join "`n")
    return $text -match "dockerDesktopLinuxEngine" -or
        $text -match "docker_engine" -or
        $text -match "failed to connect to the docker API" -or
        $text -match "daemon is not running" -or
        $text -match "Cannot connect to the Docker daemon" -or
        $text -match "The system cannot find the file specified"
}

function Get-DittoDockerFailureMessage {
    param(
        [Parameter(Mandatory=$true)][string]$FailureMessage,
        [string[]]$Output = @()
    )

    if (Test-DittoDockerEngineError -Output $Output) {
        return "$FailureMessage Docker Desktop non risponde: il motore Linux non e' raggiungibile. Lo script ha gia' provato ad avviare servizio/app e a usare un DOCKER_CONFIG temporaneo se i context utente erano bloccati. Apri Docker Desktop, attendi che dica 'Docker Desktop is running', poi rilancia lo script. Se resta bloccato, verifica WSL 2 dalle impostazioni di Docker Desktop."
    }

    if ($Output) {
        return "$FailureMessage $($Output -join ' ')"
    }
    return $FailureMessage
}

function Install-DittoWingetPackage {
    param(
        [Parameter(Mandatory=$true)][string]$PackageId,
        [string[]]$FallbackPackageIds = @(),
        [Parameter(Mandatory=$true)][string]$DisplayName,
        [switch]$CheckOnly
    )

    if ($CheckOnly) {
        Write-DittoWarn "$DisplayName non e' disponibile. CheckOnly: salto installazione automatica."
        return $false
    }

    if (-not (Test-DittoCommand "winget")) {
        Write-DittoError "$DisplayName non e' disponibile e winget non e' nel PATH."
        Write-DittoInfo "Installa App Installer dal Microsoft Store, poi rilancia lo script."
        Write-DittoInfo "In alternativa installa manualmente: $DisplayName"
        return $false
    }

    $ids = @($PackageId) + $FallbackPackageIds
    foreach ($id in $ids) {
        Write-DittoInfo "Provo a installare $DisplayName con winget ($id)..."
        $exitCode = Invoke-DittoTool -FilePath "winget" -Arguments @("install", "-e", "--id", $id, "--accept-package-agreements", "--accept-source-agreements")
        Update-DittoPath
        if ($exitCode -eq 0) {
            Write-DittoOk "$DisplayName installato o gia' presente."
            return $true
        }
        Write-DittoWarn "Installazione winget fallita per $id."
    }

    Write-DittoError "Non sono riuscito a installare $DisplayName automaticamente."
    return $false
}

function Ensure-DittoCommand {
    param(
        [Parameter(Mandatory=$true)][string]$CommandName,
        [Parameter(Mandatory=$true)][string]$DisplayName,
        [string]$PackageId = "",
        [string[]]$FallbackPackageIds = @(),
        [switch]$CheckOnly
    )

    if (Test-DittoCommand $CommandName) {
        Write-DittoOk "$DisplayName disponibile."
        return $true
    }

    if (-not $PackageId) {
        Write-DittoError "$DisplayName non trovato nel PATH."
        return $false
    }

    $installed = Install-DittoWingetPackage -PackageId $PackageId -FallbackPackageIds $FallbackPackageIds -DisplayName $DisplayName -CheckOnly:$CheckOnly
    if (-not $installed) {
        return $false
    }

    Update-DittoPath
    if (Test-DittoCommand $CommandName) {
        Write-DittoOk "$DisplayName ora disponibile."
        return $true
    }

    Write-DittoError "$DisplayName risulta installato, ma non e' ancora disponibile nel PATH di questa finestra."
    Write-DittoInfo "Chiudi e riapri il terminale, poi rilancia lo script."
    return $false
}

function Get-DittoPythonCommand {
    param([switch]$CheckOnly)

    if (Test-DittoCommand "py") {
        return @{ Exe = "py"; Args = @("-3") }
    }
    if (Test-DittoCommand "python") {
        return @{ Exe = "python"; Args = @() }
    }

    $installed = Install-DittoWingetPackage -PackageId "Python.Python.3.13" -FallbackPackageIds @("Python.Python.3.12") -DisplayName "Python 3" -CheckOnly:$CheckOnly
    if ($installed) {
        Update-DittoPath
        if (Test-DittoCommand "py") {
            return @{ Exe = "py"; Args = @("-3") }
        }
        if (Test-DittoCommand "python") {
            return @{ Exe = "python"; Args = @() }
        }
    }

    throw "Python 3 non trovato. Installa Python 3.12+ oppure abilita winget e rilancia."
}

function Invoke-DittoPython {
    param(
        [Parameter(Mandatory=$true)][hashtable]$Python,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = "",
        [string]$FailureMessage = "Comando Python fallito."
    )

    Invoke-DittoToolChecked -FilePath $Python.Exe -Arguments (@($Python.Args) + $Arguments) -WorkingDirectory $WorkingDirectory -FailureMessage $FailureMessage
}

function Get-DittoLocalIp {
    try {
        $defaultRoute = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix "0.0.0.0/0" -ErrorAction Stop |
            Sort-Object RouteMetric, InterfaceMetric |
            Select-Object -First 1
        if ($defaultRoute) {
            $adapter = Get-NetAdapter -InterfaceIndex $defaultRoute.InterfaceIndex -ErrorAction Stop
            if (-not (Test-DittoVirtualAdapterName -Name $adapter.Name) -and -not (Test-DittoVirtualAdapterName -Name $adapter.InterfaceDescription)) {
                $routeIp = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $defaultRoute.InterfaceIndex -ErrorAction Stop |
                    Where-Object { Test-DittoUsableIpv4 -IpAddress $_.IPAddress } |
                    Select-Object -First 1 -ExpandProperty IPAddress
                if ($routeIp) {
                    return $routeIp
                }
            }
        }
    } catch {
    }

    try {
        $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                (Test-DittoUsableIpv4 -IpAddress $_.IPAddress) -and
                -not (Test-DittoVirtualAdapterName -Name $_.InterfaceAlias)
            } |
            Select-Object -First 1 -ExpandProperty IPAddress
        if ($ip) {
            return $ip
        }
    } catch {
    }

    $ipconfigCandidates = Get-DittoIpconfigCandidates
    $preferred = $ipconfigCandidates |
        Where-Object { -not (Test-DittoVirtualAdapterName -Name $_.AdapterName) -and (Test-DittoUsableIpv4 -IpAddress $_.IPAddress) } |
        Select-Object -First 1
    if ($preferred) {
        return $preferred.IPAddress
    }

    $fallback = $ipconfigCandidates |
        Where-Object { Test-DittoUsableIpv4 -IpAddress $_.IPAddress } |
        Select-Object -First 1
    if ($fallback) {
        return $fallback.IPAddress
    }

    return "localhost"
}

function Get-DittoIpconfigCandidates {
    $candidates = @()
    $currentAdapter = ""

    foreach ($line in (ipconfig /all)) {
        $text = $line.ToString()
        if ($text -match "^[^\s].*:\s*$") {
            $currentAdapter = $text.Trim().TrimEnd(":")
            continue
        }

        if ($text -match "IPv4.*?:\s*([0-9]+(?:\.[0-9]+){3})") {
            $candidates += [pscustomobject]@{
                AdapterName = $currentAdapter
                IPAddress = $Matches[1]
            }
        }
    }
    return $candidates
}

function Test-DittoUsableIpv4 {
    param([string]$IpAddress)

    if (-not $IpAddress) {
        return $false
    }

    return $IpAddress -notlike "127.*" -and
        $IpAddress -notlike "169.254.*" -and
        $IpAddress -ne "0.0.0.0" -and
        $IpAddress -notlike "172.16.*" -and
        $IpAddress -notlike "172.17.*" -and
        $IpAddress -notlike "172.18.*" -and
        $IpAddress -notlike "172.19.*" -and
        $IpAddress -notlike "172.20.*" -and
        $IpAddress -notlike "172.21.*" -and
        $IpAddress -notlike "172.22.*" -and
        $IpAddress -notlike "172.23.*" -and
        $IpAddress -notlike "172.24.*" -and
        $IpAddress -notlike "172.25.*" -and
        $IpAddress -notlike "172.26.*" -and
        $IpAddress -notlike "172.27.*" -and
        $IpAddress -notlike "172.28.*" -and
        $IpAddress -notlike "172.29.*" -and
        $IpAddress -notlike "172.30.*" -and
        $IpAddress -notlike "172.31.*"
}

function Test-DittoVirtualAdapterName {
    param([string]$Name)

    if (-not $Name) {
        return $false
    }

    return $Name -match "(?i)wsl|docker|vEthernet|Hyper-V|Loopback|Bluetooth|VMware|VirtualBox|Tailscale|ZeroTier"
}

function Read-DittoEnvFile {
    param([Parameter(Mandatory=$true)][string]$Path)

    $values = @{}
    if (-not (Test-Path $Path)) {
        return $values
    }

    foreach ($line in Get-Content $Path) {
        if (-not $line -or $line.TrimStart().StartsWith("#") -or $line -notmatch "=") {
            continue
        }
        $key, $value = $line.Split("=", 2)
        $values[$key.Trim()] = $value
    }
    return $values
}

function Set-DittoEnvValues {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][hashtable]$Values
    )

    $lines = @()
    if (Test-Path $Path) {
        $lines = @(Get-Content $Path)
    }

    foreach ($key in $Values.Keys) {
        $lineValue = "$key=$($Values[$key])"
        $index = -1
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match ("^" + [regex]::Escape($key) + "=")) {
                $index = $i
                break
            }
        }
        if ($index -ge 0) {
            $lines[$index] = $lineValue
        } else {
            $lines += $lineValue
        }
    }

    Set-Content -Path $Path -Value $lines -Encoding ascii
}

function New-DittoBackendEnv {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$Ip,
        [Parameter(Mandatory=$true)][hashtable]$OllamaConfig,
        [int]$FrontendPort = $DittoDefaultFrontendPort
    )

    $databasePassword = -join (([guid]::NewGuid().ToString("N")), ([guid]::NewGuid().ToString("N")))
    $secretKey = -join (([guid]::NewGuid().ToString("N")), ([guid]::NewGuid().ToString("N")))
    $adminPasswordChars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#$%&?"
    $adminPassword = -join (1..20 | ForEach-Object {
        $adminPasswordChars[(Get-Random -Minimum 0 -Maximum $adminPasswordChars.Length)]
    })

    if (Test-Path $Path) {
        $existingDatabasePassword = Select-String -Path $Path -Pattern "^DATABASE_PASSWORD=" | Select-Object -First 1
        if ($existingDatabasePassword) {
            $databasePassword = $existingDatabasePassword.Line.Split("=", 2)[1]
        }
    }

    $lines = @(
        "DATABASE_HOST=127.0.0.1",
        "DATABASE_PORT=5432",
        "DATABASE_USER=postgres",
        "DATABASE_PASSWORD=$databasePassword",
        "DATABASE_NAME=ditto_db",
        "SECRET_KEY=$secretKey",
        "ADMIN_USERNAME=admin",
        "ADMIN_PASSWORD=$adminPassword",
        "ACCESS_TOKEN_EXPIRE_MINUTES=480",
        "ADMIN_TOKEN_EXPIRE_MINUTES=120",
        "OPERATOR_REFRESH_TOKEN_EXPIRE_MINUTES=480",
        "ADMIN_REFRESH_TOKEN_EXPIRE_MINUTES=120",
        "ALGORITHM=HS256",
        "ALLOWED_ORIGINS=https://localhost:$FrontendPort,https://$Ip`:$FrontendPort",
        "REFRESH_TOKEN_COOKIE_SECURE=true",
        "REFRESH_TOKEN_COOKIE_SAMESITE=lax",
        "OLLAMA_BASE_URL=$($OllamaConfig.BaseUrl)",
        "OLLAMA_MODEL=$($OllamaConfig.Model)",
        "OLLAMA_RUNTIME=$($OllamaConfig.Runtime)",
        "OLLAMA_ACCELERATOR=$($OllamaConfig.Accelerator)",
        "OLLAMA_NATIVE_VULKAN=$($OllamaConfig.NativeVulkan)",
        "OLLAMA_TIMEOUT_SECONDS=120",
        "OLLAMA_HEALTH_TIMEOUT_SECONDS=5",
        "OLLAMA_KEEP_ALIVE=30m",
        "OLLAMA_NUM_PREDICT_CLASSIFY=4",
        "OLLAMA_NUM_PREDICT_SELECT=2",
        "OLLAMA_NUM_PREDICT_RERANK=12",
        "OLLAMA_TOP_K=20",
        "OLLAMA_TOP_P=0.8",
        "OLLAMA_TEMPERATURE_CLASSIFY=0.0",
        "OLLAMA_TEMPERATURE_SELECT=0.0",
        "OLLAMA_NUM_CTX=2048",
        "OLLAMA_NUM_THREAD=4",
        "TTS_ENABLED=true"
    )
    Set-Content -Path $Path -Value $lines -Encoding ascii
}

function Get-DittoOllamaConfig {
    param([Parameter(Mandatory=$true)][string]$BackendEnvPath)

    $envValues = Read-DittoEnvFile -Path $BackendEnvPath
    return @{
        Model = $(if ($envValues["OLLAMA_MODEL"]) { $envValues["OLLAMA_MODEL"] } else { $DittoDefaultOllamaModel })
        BaseUrl = $(if ($envValues["OLLAMA_BASE_URL"]) { $envValues["OLLAMA_BASE_URL"] } else { $DittoDefaultOllamaBaseUrl })
        Runtime = $(if ($envValues["OLLAMA_RUNTIME"]) { $envValues["OLLAMA_RUNTIME"] } else { "auto" })
        Accelerator = $(if ($envValues["OLLAMA_ACCELERATOR"]) { $envValues["OLLAMA_ACCELERATOR"] } else { "auto" })
        NativeVulkan = $(if ($envValues["OLLAMA_NATIVE_VULKAN"]) { $envValues["OLLAMA_NATIVE_VULKAN"] } elseif ($envValues["OLLAMA_VULKAN"]) { $envValues["OLLAMA_VULKAN"] } else { "1" })
        KeepAlive = $(if ($envValues["OLLAMA_KEEP_ALIVE"]) { $envValues["OLLAMA_KEEP_ALIVE"] } else { "30m" })
        TopK = $(if ($envValues["OLLAMA_TOP_K"]) { $envValues["OLLAMA_TOP_K"] } else { "20" })
        TopP = $(if ($envValues["OLLAMA_TOP_P"]) { $envValues["OLLAMA_TOP_P"] } else { "0.8" })
        NumCtx = $(if ($envValues["OLLAMA_NUM_CTX"]) { $envValues["OLLAMA_NUM_CTX"] } else { "2048" })
        NumThread = $(if ($envValues["OLLAMA_NUM_THREAD"]) { $envValues["OLLAMA_NUM_THREAD"] } else { "4" })
    }
}

function Get-DittoOllamaRuntime {
    param(
        [Parameter(Mandatory=$true)][hashtable]$Config,
        [switch]$CheckOnly
    )

    if ($Config.Runtime -ieq "native") {
        Ensure-DittoCommand -CommandName "ollama" -DisplayName "Ollama nativo" -PackageId "Ollama.Ollama" -CheckOnly:$CheckOnly | Out-Null
        return @{ UseNative = $true; ComposeArgs = @("-f", "docker-compose.yml") }
    }

    if ($Config.Runtime -ieq "auto" -and (Test-DittoCommand "ollama")) {
        Write-DittoInfo "Runtime Ollama auto: uso Ollama nativo su Windows."
        return @{ UseNative = $true; ComposeArgs = @("-f", "docker-compose.yml") }
    }

    $composeArgs = @("-f", "docker-compose.yml")
    if ($Config.Accelerator -ieq "nvidia") {
        Write-DittoInfo "Accelerazione Ollama Docker: NVIDIA."
        $composeArgs = @("-f", "docker-compose.yml", "-f", "docker-compose.nvidia.yml")
    } elseif ($Config.Accelerator -ieq "amd") {
        Write-DittoWarn "GPU AMD in Docker e' supportata soprattutto su host Linux/WSL con ROCm."
        Write-DittoWarn "Su Windows e' consigliato Ollama nativo per usare la GPU AMD."
        $composeArgs = @("-f", "docker-compose.yml", "-f", "docker-compose.amd.yml")
    } else {
        Write-DittoInfo "Runtime Ollama: Docker CPU/default."
    }

    return @{ UseNative = $false; ComposeArgs = $composeArgs }
}

function Start-DittoDockerDesktop {
    Start-DittoDockerService | Out-Null

    $candidates = @(
        (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Docker\Docker\Docker Desktop.exe"),
        (Join-Path $env:LocalAppData "Docker\Docker Desktop.exe")
    )

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) {
            Write-DittoInfo "Avvio Docker Desktop..."
            Start-Process -FilePath $candidate | Out-Null
            return $true
        }
    }

    Write-DittoWarn "Docker Desktop non sembra installato in un percorso noto."
    return $false
}

function Start-DittoDockerService {
    $service = Get-Service -Name "com.docker.service" -ErrorAction SilentlyContinue
    if (-not $service) {
        return $false
    }

    if ($service.Status -eq "Running") {
        return $true
    }

    try {
        Write-DittoInfo "Avvio servizio Docker Desktop..."
        Start-Service -Name "com.docker.service"
        return $true
    } catch {
        Write-DittoWarn "Non riesco ad avviare il servizio Docker Desktop automaticamente: $($_.Exception.Message)"
        Write-DittoInfo "Se Docker Desktop mostra una richiesta di permessi, accettala e lascia aperta l'app."
        return $false
    }
}

function Wait-DittoDocker {
    param([int]$TimeoutSeconds = 120)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $nextNotice = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
        $result = Invoke-DittoCapturedTool -FilePath "docker" -Arguments @("info")
        if ($result.ExitCode -eq 0) {
            Write-DittoOk "Docker e' pronto."
            return $true
        }
        if ((Get-Date) -ge $nextNotice) {
            Write-DittoInfo "Sto ancora aspettando Docker Desktop..."
            $nextNotice = (Get-Date).AddSeconds(15)
        }
        Start-Sleep -Seconds 3
    }
    return $false
}

function Ensure-DittoDocker {
    param([switch]$CheckOnly)

    Ensure-DittoCommand -CommandName "docker" -DisplayName "Docker Desktop" -PackageId "Docker.DockerDesktop" -CheckOnly:$CheckOnly | Out-Null
    if (-not (Test-DittoCommand "docker")) {
        throw "Docker non disponibile."
    }

    if ($CheckOnly) {
        Write-DittoInfo "CheckOnly: non invoco Docker Compose e non controllo il daemon."
        return
    }

    Use-DittoWritableDockerConfig

    $info = Invoke-DittoCapturedTool -FilePath "docker" -Arguments @("info")
    if ($info.ExitCode -eq 0) {
        Write-DittoOk "Docker daemon gia' attivo."
    } else {
        Start-DittoDockerDesktop | Out-Null
        if (-not (Wait-DittoDocker -TimeoutSeconds 300)) {
            throw "Docker Desktop non risponde: il motore Linux non e' raggiungibile. Lo script ha gia' provato ad avviare servizio/app e a usare un DOCKER_CONFIG temporaneo se i context utente erano bloccati. Apri Docker Desktop, attendi che dica 'Docker Desktop is running', poi rilancia lo script. Se resta bloccato, verifica WSL 2 dalle impostazioni di Docker Desktop."
        }
    }

    $compose = Invoke-DittoCapturedTool -FilePath "docker" -Arguments @("compose", "version")
    if ($compose.ExitCode -ne 0) {
        throw "Docker Compose v2 non disponibile. Aggiorna o reinstalla Docker Desktop."
    }
    Write-DittoOk "Docker Compose disponibile."
}

function Use-DittoWritableDockerConfig {
    if ($env:DITTO_DOCKER_CONFIG_READY -eq "1") {
        return
    }

    $dockerUserDir = Join-Path $env:USERPROFILE ".docker"
    $pathsToProbe = @(
        (Join-Path $dockerUserDir "config.json"),
        (Join-Path $dockerUserDir "contexts\meta")
    )

    try {
        foreach ($path in $pathsToProbe) {
            if (Test-Path $path -PathType Leaf) {
                $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
                $stream.Close()
            } elseif (Test-Path $path -PathType Container) {
                Get-ChildItem -LiteralPath $path -ErrorAction Stop | Select-Object -First 1 | Out-Null
            }
        }
    } catch {
        $fallbackDir = Join-Path $env:TEMP "ditto-docker-config"
        New-Item -ItemType Directory -Force -Path $fallbackDir | Out-Null
        $env:DOCKER_CONFIG = $fallbackDir
        Write-DittoWarn "Docker config utente non leggibile: uso DOCKER_CONFIG temporaneo per questa sessione."
    }
    $env:DITTO_DOCKER_CONFIG_READY = "1"
}

function Ensure-DittoHttpsCertificate {
    param(
        [Parameter(Mandatory=$true)][string]$RootDir,
        [Parameter(Mandatory=$true)][string]$Ip,
        [switch]$CheckOnly
    )

    $certFile = Join-Path $RootDir "certs\ditto.crt"
    $keyFile = Join-Path $RootDir "certs\ditto.key"
    if ((Test-Path $certFile) -and (Test-Path $keyFile)) {
        Write-DittoOk "HTTPS attivo con certificato: $certFile"
        return @{ CertFile = $certFile; KeyFile = $keyFile }
    }

    Ensure-DittoCommand -CommandName "mkcert" -DisplayName "mkcert" -PackageId "FiloSottile.mkcert" -CheckOnly:$CheckOnly | Out-Null
    if ($CheckOnly) {
        Write-DittoInfo "CheckOnly: non genero certificati HTTPS."
        return @{ CertFile = $certFile; KeyFile = $keyFile }
    }

    if (-not (Test-DittoCommand "mkcert")) {
        throw "mkcert non disponibile."
    }

    $certDir = Join-Path $RootDir "certs"
    New-Item -ItemType Directory -Force -Path $certDir | Out-Null
    Write-DittoInfo "Genero certificato HTTPS per $Ip, localhost, 127.0.0.1 e ditto.lan..."
    Invoke-DittoToolChecked -FilePath "mkcert" -Arguments @("-cert-file", $certFile, "-key-file", $keyFile, $Ip, "localhost", "127.0.0.1", "ditto.lan") -FailureMessage "Generazione certificato HTTPS fallita."

    if (-not (Test-Path $certFile) -or -not (Test-Path $keyFile)) {
        throw "Certificato HTTPS non creato correttamente."
    }
    Write-DittoOk "Certificato HTTPS generato."
    return @{ CertFile = $certFile; KeyFile = $keyFile }
}

function Wait-DittoPostgres {
    param([int]$MaxAttempts = 30)

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        $result = Invoke-DittoCapturedTool -FilePath "docker" -Arguments @("exec", "ditto_postgres", "pg_isready", "-U", "postgres")
        if ($result.ExitCode -eq 0) {
            Write-DittoOk "PostgreSQL e' pronto."
            return $true
        }
        Start-Sleep -Seconds 2
    }
    Write-DittoWarn "PostgreSQL potrebbe non essere ancora pronto."
    return $false
}

function Test-DittoHttp {
    param(
        [Parameter(Mandatory=$true)][string]$Url,
        [int]$TimeoutSeconds = 3
    )

    try {
        Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec $TimeoutSeconds | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Ensure-DittoNativeOllama {
    param(
        [Parameter(Mandatory=$true)][hashtable]$Config,
        [switch]$CheckOnly
    )

    Ensure-DittoCommand -CommandName "ollama" -DisplayName "Ollama nativo" -PackageId "Ollama.Ollama" -CheckOnly:$CheckOnly | Out-Null
    if ($CheckOnly) {
        Write-DittoInfo "CheckOnly: non avvio Ollama nativo."
        return
    }

    if (-not (Test-DittoCommand "ollama")) {
        throw "Ollama nativo non disponibile."
    }

    if (Test-DittoHttp -Url "$($Config.BaseUrl)/api/tags") {
        Write-DittoOk "Ollama nativo raggiungibile."
        return
    }

    Write-DittoInfo "Avvio Ollama nativo in background..."
    Start-Process -FilePath "cmd.exe" -ArgumentList @("/k", "set OLLAMA_VULKAN=$($Config.NativeVulkan) && ollama serve") -WindowStyle Normal | Out-Null
    for ($attempt = 1; $attempt -le 20; $attempt++) {
        Start-Sleep -Seconds 2
        if (Test-DittoHttp -Url "$($Config.BaseUrl)/api/tags") {
            Write-DittoOk "Ollama nativo raggiungibile."
            return
        }
    }
    Write-DittoWarn "Ollama nativo non risponde ancora su $($Config.BaseUrl)."
}

function Ensure-DittoOllamaModel {
    param(
        [Parameter(Mandatory=$true)][hashtable]$Config,
        [Parameter(Mandatory=$true)][hashtable]$Runtime,
        [switch]$CheckOnly
    )

    if ($CheckOnly) {
        Write-DittoInfo "CheckOnly: non controllo ne' scarico il modello Ollama."
        return
    }

    Write-DittoInfo "Preparazione modello AI: $($Config.Model)"
    if ($Runtime.UseNative) {
        Ensure-DittoNativeOllama -Config $Config
        $models = @(ollama list 2>$null)
        if (-not ($models | Select-String -SimpleMatch $Config.Model)) {
            Write-DittoInfo "Modello non trovato in Ollama nativo. Avvio pull..."
            Invoke-DittoToolChecked -FilePath "ollama" -Arguments @("pull", $Config.Model) -FailureMessage "Pull modello Ollama nativo fallito."
        }
        Write-DittoOk "Modello $($Config.Model) pronto su Ollama nativo."
    } else {
        $modelResult = Invoke-DittoCapturedTool -FilePath "docker" -Arguments @("exec", "ditto_ollama", "ollama", "list")
        $models = @($modelResult.Output)
        if (-not ($models | Select-String -SimpleMatch $Config.Model)) {
            Write-DittoInfo "Modello non trovato nel container Ollama. Avvio pull..."
            Invoke-DittoDocker -Arguments @("exec", "ditto_ollama", "ollama", "pull", $Config.Model) -FailureMessage "Pull modello Ollama container fallito."
        }
        Write-DittoOk "Modello $($Config.Model) pronto nel container."
    }
}

function Invoke-DittoOllamaWarmup {
    param(
        [Parameter(Mandatory=$true)][hashtable]$Config,
        [switch]$CheckOnly
    )

    if ($CheckOnly) {
        Write-DittoInfo "CheckOnly: salto warmup Ollama."
        return
    }

    Write-DittoInfo "Attendo che Ollama risponda su $($Config.BaseUrl)..."
    $ready = $false
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        if (Test-DittoHttp -Url "$($Config.BaseUrl)/api/tags" -TimeoutSeconds 5) {
            $ready = $true
            break
        }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) {
        Write-DittoWarn "Ollama non risponde ancora all'endpoint /api/tags."
        return
    }

    Write-DittoInfo "Warmup modello AI in corso..."
    $body = @{
        model = $Config.Model
        prompt = "Rispondi solo OK"
        stream = $false
        think = $false
        keep_alive = $Config.KeepAlive
        options = @{
            temperature = 0
            top_k = [int]$Config.TopK
            top_p = [double]$Config.TopP
            num_predict = 12
            num_ctx = [int]$Config.NumCtx
            num_thread = [int]$Config.NumThread
        }
    } | ConvertTo-Json -Depth 4

    try {
        Invoke-RestMethod -Uri "$($Config.BaseUrl)/api/generate" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 120 | Out-Null
        Write-DittoOk "Modello AI pronto."
    } catch {
        Write-DittoWarn "Warmup Ollama non completato. Il primo prompt potrebbe essere piu' lento."
    }
}

function Ensure-DittoBackendDependencies {
    param(
        [Parameter(Mandatory=$true)][string]$BackendDir,
        [Parameter(Mandatory=$true)][hashtable]$Python,
        [switch]$CheckOnly
    )

    $venvDir = Join-Path $BackendDir "venv"
    if ($CheckOnly) {
        Write-DittoInfo "CheckOnly: verifico solo se venv esiste: $([bool](Test-Path $venvDir))"
        return
    }

    if (-not (Test-Path $venvDir)) {
        Write-DittoInfo "Creo ambiente virtuale backend..."
        Invoke-DittoPython -Python $Python -Arguments @("-m", "venv", "venv") -WorkingDirectory $BackendDir -FailureMessage "Creazione venv fallita."
    }

    $venvPython = Join-Path $venvDir "Scripts\python.exe"
    if (-not (Test-Path $venvPython)) {
        throw "Python del virtualenv non trovato: $venvPython"
    }

    Ensure-DittoPipCurrent -VenvPython $venvPython -BackendDir $BackendDir

    if (Test-Path (Join-Path $BackendDir "requirements.txt")) {
        Write-DittoInfo "Installo dipendenze Python da requirements.txt..."
        Invoke-DittoToolChecked -FilePath $venvPython -Arguments @("-m", "pip", "install", "-r", "requirements.txt", "--quiet") -WorkingDirectory $BackendDir -FailureMessage "Installazione dipendenze Python fallita."
    } else {
        Write-DittoWarn "requirements.txt non trovato, installo dipendenze base."
        Invoke-DittoToolChecked -FilePath $venvPython -Arguments @("-m", "pip", "install", "fastapi", "uvicorn", "sqlalchemy", "psycopg2-binary", "python-jose[cryptography]", "passlib[bcrypt]", "python-multipart", "python-dotenv", "requests", "--quiet") -WorkingDirectory $BackendDir -FailureMessage "Installazione dipendenze Python base fallita."
    }
}

function Ensure-DittoPipCurrent {
    param(
        [Parameter(Mandatory=$true)][string]$VenvPython,
        [Parameter(Mandatory=$true)][string]$BackendDir
    )

    $before = Get-DittoPipVersion -VenvPython $VenvPython -BackendDir $BackendDir
    if ($before) {
        Write-DittoInfo "Verifico pip (versione attuale: $before)..."
    } else {
        Write-DittoInfo "Verifico pip..."
    }

    $upgrade = Invoke-DittoCapturedTool -FilePath $VenvPython -Arguments @("-m", "pip", "install", "--upgrade", "pip", "--quiet", "--disable-pip-version-check") -WorkingDirectory $BackendDir
    if ($upgrade.ExitCode -ne 0) {
        Write-DittoWarn "Aggiornamento pip non completato; continuo con la versione installata."
        if ($upgrade.Output) {
            Write-DittoWarn ($upgrade.Output | Select-Object -Last 1)
        }
        return
    }

    $after = Get-DittoPipVersion -VenvPython $VenvPython -BackendDir $BackendDir
    if ($before -and $after -and $before -ne $after) {
        Write-DittoOk "pip aggiornato: $before -> $after"
    } elseif ($after) {
        Write-DittoOk "pip gia' aggiornato: $after"
    } else {
        Write-DittoOk "pip verificato."
    }
}

function Get-DittoPipVersion {
    param(
        [Parameter(Mandatory=$true)][string]$VenvPython,
        [Parameter(Mandatory=$true)][string]$BackendDir
    )

    $result = Invoke-DittoCapturedTool -FilePath $VenvPython -Arguments @("-m", "pip", "--version") -WorkingDirectory $BackendDir
    if ($result.ExitCode -ne 0 -or -not $result.Output) {
        return ""
    }

    $line = ($result.Output | Select-Object -First 1)
    if ($line -match "pip\s+([^\s]+)") {
        return $Matches[1]
    }
    return $line
}

function Ensure-DittoFrontendDependencies {
    param(
        [Parameter(Mandatory=$true)][string]$FrontendDir,
        [switch]$CheckOnly
    )

    Ensure-DittoCommand -CommandName "node" -DisplayName "Node.js" -PackageId "OpenJS.NodeJS.LTS" -CheckOnly:$CheckOnly | Out-Null
    Ensure-DittoCommand -CommandName "npm" -DisplayName "npm" -PackageId "OpenJS.NodeJS.LTS" -CheckOnly:$CheckOnly | Out-Null

    if ($CheckOnly) {
        Write-DittoInfo "CheckOnly: verifico solo se node_modules esiste: $([bool](Test-Path (Join-Path $FrontendDir "node_modules")))"
        return
    }

    if (-not (Test-DittoCommand "npm")) {
        throw "npm non disponibile."
    }

    if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
        Write-DittoInfo "Installo dipendenze Node.js..."
        Invoke-DittoToolChecked -FilePath "npm" -Arguments @("install") -WorkingDirectory $FrontendDir -FailureMessage "Installazione dipendenze frontend fallita."
    } else {
        Write-DittoOk "Dipendenze Node.js gia' installate."
    }
}

function Start-DittoCmdWindow {
    param(
        [Parameter(Mandatory=$true)][string]$Title,
        [Parameter(Mandatory=$true)][string]$Command
    )

    Start-Process -FilePath "cmd.exe" -ArgumentList @("/k", "title $Title && $Command") -WindowStyle Normal | Out-Null
}
