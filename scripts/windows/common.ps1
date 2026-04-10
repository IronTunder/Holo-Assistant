$ErrorActionPreference = "Stop"

$HoloAssistantDefaultBackendPort = 8000
$HoloAssistantDefaultFrontendPort = 5173
$HoloAssistantDefaultOllamaModel = "qwen3.5:9b"
$HoloAssistantDefaultOllamaBaseUrl = "http://127.0.0.1:11434"
$HoloAssistantVoskModelPublicUrl = "/models/vosk-model-small-it-0.22.tar.gz"
$HoloAssistantVoskModelArchiveName = "vosk-model-small-it-0.22.tar.gz"
$HoloAssistantPiperDefaultVoiceKey = "it_IT-paola-medium"
$HoloAssistantPiperDefaultVoiceModelFilename = "$HoloAssistantPiperDefaultVoiceKey.onnx"
$HoloAssistantPiperDefaultVoiceConfigFilename = "$HoloAssistantPiperDefaultVoiceModelFilename.json"
$HoloAssistantWslInstallBaseDistro = "Ubuntu-24.04"
$HoloAssistantWslDedicatedDistro = "holo_assistant_wsl"
$HoloAssistantWindowsScriptDir = $PSScriptRoot

function Write-HoloAssistantInfo {
    param([string]$Message)
    Write-Host "[INFO] $Message"
}

function Write-HoloAssistantOk {
    param([string]$Message)
    Write-Host "[OK] $Message"
}

function Write-HoloAssistantWarn {
    param([string]$Message)
    Write-Host "[AVVISO] $Message"
}

function Write-HoloAssistantError {
    param([string]$Message)
    Write-Host "[ERRORE] $Message"
}

function Write-HoloAssistantStep {
    param([string]$Message)
    Write-Host ""
    Write-Host $Message
}

function Get-HoloAssistantRoot {
    return (Resolve-Path (Join-Path $HoloAssistantWindowsScriptDir "..\..")).Path
}

function Test-HoloAssistantCommand {
    param([Parameter(Mandatory=$true)][string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Update-HoloAssistantPath {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = @($machinePath, $userPath, $env:Path) -join ";"
}

function Convert-HoloAssistantConsoleText {
    param([AllowNull()][string]$Text)

    if ($null -eq $Text) {
        return ""
    }

    $clean = $Text -replace "`0", ""
    $clean = $clean -replace "[\x00-\x08\x0B\x0C\x0E-\x1F]", ""
    $clean = $clean.Replace(([string][char]211), "a")
    $clean = $clean.Replace(([string][char]222), "e")
    $clean = $clean.Replace(([string][char]168), "u")
    $clean = $clean.Replace(([string][char]172), "i")

    return $clean
}

function Get-HoloAssistantShellQuotedValue {
    param([AllowNull()][string]$Value)

    if ($null -eq $Value) {
        return "''"
    }

    return "'" + ($Value -replace "'", "'\''") + "'"
}

function Convert-HoloAssistantWindowsPathToWsl {
    param([Parameter(Mandatory=$true)][string]$Path)

    $resolved = (Resolve-Path $Path).Path
    $normalized = $resolved -replace "\\", "/"
    if ($normalized -match "^([A-Za-z]):/(.*)$") {
        return "/mnt/$($Matches[1].ToLower())/$($Matches[2])"
    }

    throw "Percorso non convertibile per WSL: $Path"
}

function Test-HoloAssistantIsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Start-HoloAssistantElevatedPowerShell {
    param(
        [Parameter(Mandatory=$true)][string]$ScriptPath,
        [string[]]$ScriptArguments = @()
    )

    $argumentList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$ScriptPath`"")
    foreach ($arg in $ScriptArguments) {
        $argumentList += "`"$arg`""
    }

    Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList ($argumentList -join " ")
}

function Set-HoloAssistantWslDistributionName {
    param([AllowNull()][string]$Name)

    if ($Name) {
        $env:HOLO_ASSISTANT_WSL_DISTRO = $Name
        return
    }

    Remove-Item Env:\HOLO_ASSISTANT_WSL_DISTRO -ErrorAction SilentlyContinue
}

function Invoke-HoloAssistantTool {
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
        $output = @(& $FilePath @Arguments 2>&1 | ForEach-Object { Convert-HoloAssistantConsoleText $_.ToString() })
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

function Invoke-HoloAssistantToolChecked {
    param(
        [Parameter(Mandatory=$true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = "",
        [string]$FailureMessage = "Comando fallito.",
        [switch]$AllowFailure  # Aggiunto parametro AllowFailure
    )

    $exitCode = Invoke-HoloAssistantTool -FilePath $FilePath -Arguments $Arguments -WorkingDirectory $WorkingDirectory
    if ($exitCode -ne 0 -and -not $AllowFailure) {
        throw "$FailureMessage Exit code: $exitCode"
    }
    return $exitCode
}

function Get-HoloAssistantWslDistributionName {
    if ($env:HOLO_ASSISTANT_WSL_DISTRO) {
        return $env:HOLO_ASSISTANT_WSL_DISTRO
    }

    $existingDistros = Get-HoloAssistantWslDistributions
    if ($existingDistros.Count -gt 0) {
        $selectedDistro = $existingDistros[0]
        Set-HoloAssistantWslDistributionName -Name $selectedDistro
        return $selectedDistro
    }

    return $HoloAssistantWslDedicatedDistro
}

function Get-HoloAssistantWslStatus {
    $selectedDistro = Get-HoloAssistantWslDistributionName
    $status = @{
        IsInstalled = $false
        IsAccessible = $false
        DefaultVersion2 = $false
        DistroName = $selectedDistro
        DistroInstalled = $false
        ExistingDistros = @()
        VirtualizationEnabled = $null
        WindowsSupported = $false
        RebootRequired = $false
        Summary = ""
    }

    try {
        $os = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion"
        $build = [int]$os.CurrentBuildNumber
        $ubr = [int]$os.UBR
        $isWin11 = $build -ge 22000
        $isSupportedWin10 = $build -gt 19044 -or ($build -eq 19044 -and $ubr -ge 1049) -or ($build -eq 19043 -and $ubr -ge 1049) -or ($build -eq 19042 -and $ubr -ge 1049) -or ($build -eq 19041 -and $ubr -ge 1049) -or ($build -eq 18362 -and $ubr -ge 1049)
        $status.WindowsSupported = $isWin11 -or $isSupportedWin10
    } catch {
        $status.WindowsSupported = $false
    }

    # Controllo WSL installato PRIMA di verificare la virtualizzazione
    if (Test-HoloAssistantCommand "wsl") {
        $status.IsInstalled = $true
        $wslStatus = Invoke-HoloAssistantCapturedTool -FilePath "wsl.exe" -Arguments @("--status")
        $text = ($wslStatus.Output -join "`n")
        if ($wslStatus.ExitCode -eq 0) {
            $status.IsAccessible = $true
            $status.DefaultVersion2 = $text -match "2"
        } elseif ($text -match "reboot" -or $text -match "riavv") {
            $status.RebootRequired = $true
        }

        $distroResult = Invoke-HoloAssistantCapturedTool -FilePath "wsl.exe" -Arguments @("--list", "--quiet")
        if ($distroResult.ExitCode -eq 0) {
            $status.IsAccessible = $true
            $status.ExistingDistros = @($distroResult.Output | ForEach-Object { $_.Trim() } | Where-Object { $_ })
            if ($status.ExistingDistros.Count -gt 0 -and -not $env:HOLO_ASSISTANT_WSL_DISTRO) {
                $status.DistroName = $status.ExistingDistros[0]
                Set-HoloAssistantWslDistributionName -Name $status.DistroName
            }
            $status.DistroInstalled = ($status.ExistingDistros | Where-Object { $_ -eq $status.DistroName }).Count -gt 0
        } elseif (($distroResult.Output -join "`n") -match "E_ACCESSDENIED") {
            $status.Summary = "WSL presente ma non accessibile in questa sessione."
        }
        
        # Solo se WSL e installato ma non funziona correttamente, controlliamo la virtualizzazione
        if ($status.DefaultVersion2 -eq $false -and $status.DistroInstalled -eq $false) {
            # Se WSL non funziona, potrebbe essere disabilitata la virtualizzazione
            try {
                $cpu = Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object -First 1
                $status.VirtualizationEnabled = [bool]$cpu.VirtualizationFirmwareEnabled
            } catch {
                $status.VirtualizationEnabled = $null
            }
        } else {
            # WSL funziona, quindi la virtualizzazione e abilitata
            $status.VirtualizationEnabled = $true
        }
    } else {
        # WSL non installato, controllo virtualizzazione per capire se possiamo installarlo
        try {
            $cpu = Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object -First 1
            $status.VirtualizationEnabled = [bool]$cpu.VirtualizationFirmwareEnabled
        } catch {
            $status.VirtualizationEnabled = $null
        }
    }

    if (-not $status.Summary) {
        $parts = @()
        $parts += "Windows supportato: $($status.WindowsSupported)"
        if ($status.IsInstalled) {
            $parts += "WSL installato: True"
            $parts += "WSL accessibile: $($status.IsAccessible)"
            $parts += "distro selezionata: $($status.DistroName)"
            $parts += "distro disponibile: $($status.DistroInstalled)"
            $parts += "WSL default v2: $($status.DefaultVersion2)"
        } else {
            $parts += "WSL installato: False"
            $parts += "virtualizzazione: $(if ($null -eq $status.VirtualizationEnabled) { 'sconosciuta' } else { $status.VirtualizationEnabled })"
        }
        if ($status.RebootRequired) {
            $parts += "riavvio richiesto: True"
        }
        $status.Summary = $parts -join ", "
    }

    return $status
}

function Invoke-HoloAssistantWsl {
    param(
        [Parameter(Mandatory=$true)][string]$Command,
        [switch]$AllowFailure,
        [string]$Activity = ""
    )

    if ($Activity) {
        Write-HoloAssistantInfo $Activity
    }
    $distroName = Get-HoloAssistantWslDistributionName
    if (-not $distroName) {
        throw "Nessuna distribuzione WSL selezionata per eseguire il comando richiesto."
    }
    $args = @("-d", $distroName, "--", "bash", "-lc", $Command)
    $result = Invoke-HoloAssistantCapturedTool -FilePath "wsl.exe" -Arguments $args
    if ($result.Output) {
        $result.Output | ForEach-Object { Write-Host $_ }
    }
    if ($result.ExitCode -ne 0 -and -not $AllowFailure) {
        throw "Comando WSL fallito. Exit code: $($result.ExitCode)"
    }
    return $result
}

function Invoke-HoloAssistantOllamaInstallScript {
    param([switch]$CheckOnly)

    if ($CheckOnly) {
        Write-HoloAssistantWarn "Ollama nativo non e' disponibile. CheckOnly: salto installazione automatica."
        return $false
    }

    Write-HoloAssistantInfo "Installo Ollama nativo con lo script ufficiale..."
    $command = "irm https://ollama.com/install.ps1 | iex"
    $result = Invoke-HoloAssistantCapturedTool -FilePath "powershell.exe" -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command)
    if ($result.Output) {
        $result.Output | ForEach-Object { Write-Host $_ }
    }
    Update-HoloAssistantPath
    return $result.ExitCode -eq 0
}

function Test-HoloAssistantDockerDirectReady {
    Use-HoloAssistantWritableDockerConfig
    if (-not (Test-HoloAssistantCommand "docker")) {
        return @{ Ready = $false; Compose = $false; Output = @("docker non trovato") }
    }

    $info = Invoke-HoloAssistantCapturedTool -FilePath "docker" -Arguments @("info")
    if ($info.ExitCode -ne 0) {
        return @{ Ready = $false; Compose = $false; Output = $info.Output }
    }

    $compose = Invoke-HoloAssistantCapturedTool -FilePath "docker" -Arguments @("compose", "version")
    return @{ Ready = $compose.ExitCode -eq 0; Compose = $compose.ExitCode -eq 0; Output = @($info.Output + $compose.Output) }
}

function Test-HoloAssistantDockerInWslReady {
    if (-not (Test-HoloAssistantCommand "wsl")) {
        return @{ Ready = $false; Output = @("WSL non disponibile") }
    }

    $distroName = Get-HoloAssistantWslDistributionName
    if (-not $distroName) {
        return @{ Ready = $false; Output = @("Nessuna distribuzione WSL selezionata") }
    }

    $dockerReadyCommand = "(docker info >/dev/null 2>&1 && docker compose version >/dev/null 2>&1) || (sudo docker info >/dev/null 2>&1 && sudo docker compose version >/dev/null 2>&1)"
    $check = Invoke-HoloAssistantCapturedTool -FilePath "wsl.exe" -Arguments @("-d", $distroName, "--", "bash", "-lc", $dockerReadyCommand)
    return @{ Ready = $check.ExitCode -eq 0; Output = $check.Output; DistroName = $distroName }
}

function Ensure-HoloAssistantWindowsSupport {
    param([switch]$AllowVirtualizationCheck)
    
    $status = Get-HoloAssistantWslStatus
    
    # Controllo base: Windows deve supportare WSL
    if (-not $status.WindowsSupported) {
        throw "Windows non supportato per il setup automatico WSL2. Serve Windows 10 build 18362.1049+ oppure Windows 11."
    }
    
    # Se WSL e gia installato, saltiamo il controllo della virtualizzazione
    if ($status.IsInstalled) {
        Write-HoloAssistantInfo "WSL gia installato, proseguo con la configurazione..."
        return $status
    }
    
    # Solo se WSL NON e installato, controlliamo la virtualizzazione
    if ($status.VirtualizationEnabled -eq $false) {
        throw "La virtualizzazione non risulta abilitata. Attivala nel BIOS/UEFI e rilancia lo script."
    }
    
    return $status
}

function Ensure-HoloAssistantWslDocker {
    param(
        [switch]$CheckOnly
    )

    $status = Ensure-HoloAssistantWindowsSupport
    Write-HoloAssistantInfo "Stato WSL: $($status.Summary)"

    if ($CheckOnly) {
        $distro = Ensure-HoloAssistantWslDistroForDocker -CheckOnly
        Write-HoloAssistantInfo "CheckOnly: distribuzione WSL selezionata: $distro"
        return $distro
    }

    # Se WSL non e installato, dobbiamo procedere con l'installazione (richiede admin)
    if (-not $status.IsInstalled) {
        Write-HoloAssistantInfo "WSL non installato. Procedo con l'installazione..."
        
        if (-not (Test-HoloAssistantIsAdmin)) {
            throw "Per installare WSL serve rilanciare lo script come amministratore."
            Write-Host ""
            Write-Host "Verra aperta una nuova finestra PowerShell come amministratore."
            Write-Host "La configurazione continuera automaticamente in quella finestra."
            Write-Host ""
            Read-Host "Premi INVIO per continuare"

            $scriptPath = $CurrentScriptPath
            if (-not $scriptPath) {
                $scriptPath = $MyInvocation.MyCommand.Path
            }
            
            Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList @(
                "-NoProfile", 
                "-ExecutionPolicy", 
                "Bypass", 
                "-File", 
                "`"$scriptPath`"",
                "-WaitSetup"
            ) -Wait
            
            # Verifica dopo l'installazione
            $direct = Test-HoloAssistantDockerDirectReady
            if ($direct.Ready) {
                $env:HOLO_ASSISTANT_DOCKER_MODE = "windows"
                Write-HoloAssistantOk "Docker disponibile dopo configurazione."
                return
            }
        }
        
        # Siamo admin, installa WSL
        Write-HoloAssistantInfo "Installazione WSL..."
        Invoke-HoloAssistantToolChecked -FilePath "wsl.exe" -Arguments @("--install", "--web-download") -FailureMessage "Installazione WSL fallita."
        Write-HoloAssistantInfo "WSL installato. Potrebbe essere necessario riavviare Windows."
        
        # Aggiorna lo stato
        $status = Get-HoloAssistantWslStatus
        if (-not $status.IsInstalled) {
            throw "WSL non rilevabile dopo l'installazione. Riavvia Windows e rilancia lo script."
        }
    }

    # A questo punto WSL e installato, continuiamo
    Write-HoloAssistantInfo "Configurazione WSL2 come backend Docker del progetto..."
    
    # Imposta WSL2 come default (non bloccante se fallisce)
    Write-HoloAssistantInfo "Imposto WSL2 come versione predefinita..."
    $setDefaultExit = Invoke-HoloAssistantToolChecked -FilePath "wsl.exe" -Arguments @("--set-default-version", "2") -FailureMessage "Impostazione WSL2 come default fallita." -AllowFailure
    if ($setDefaultExit -ne 0) {
        Write-HoloAssistantWarn "Impostazione WSL2 come default non riuscita (potrebbe essere gia configurata)."
    }
    
    # Aggiorna kernel WSL (opzionale, non bloccante)
    Write-HoloAssistantInfo "Aggiorno il kernel WSL..."
    $updateExit = Invoke-HoloAssistantToolChecked -FilePath "wsl.exe" -Arguments @("--update", "--web-download") -FailureMessage "Aggiornamento kernel WSL fallito." -AllowFailure
    if ($updateExit -ne 0) {
        Write-HoloAssistantWarn "Aggiornamento kernel WSL non riuscito (potrebbe non essere necessario)."
    }

    # Seleziona o crea distribuzione (questa funzione gestisce anche la pausa post-creazione utente)
    $distroName = Ensure-HoloAssistantWslDistroForDocker -CheckOnly:$false
    Write-HoloAssistantInfo "Uso la distribuzione WSL '$distroName' per Docker del progetto."
    
    # Verifica che la distribuzione sia registrata
    $distros = Get-HoloAssistantWslDistributions
    if ($distros -notcontains $distroName) {
        throw "Distribuzione $distroName non trovata."
    }

    # Installa Docker nella distribuzione
    $dockerInstalled = Ensure-HoloAssistantDockerInWsl -DistroName $distroName
    
    if (-not $dockerInstalled) {
        throw "Installazione Docker in $distroName fallita."
    }

    $env:HOLO_ASSISTANT_DOCKER_MODE = "wsl"
    Set-HoloAssistantWslDistributionName -Name $distroName
    Write-HoloAssistantOk "Docker disponibile tramite WSL ($distroName)."
    
    return $distroName
}

function Invoke-HoloAssistantDocker {
    param(
        [Parameter(Mandatory=$true)][string[]]$Arguments,
        [string]$WorkingDirectory = "",
        [string]$FailureMessage = "Comando Docker fallito.",
        [switch]$AllowFailure
    )

    if ($env:HOLO_ASSISTANT_DOCKER_MODE -eq "wsl") {
        $commandParts = @()
        if ($WorkingDirectory) {
            $wslDir = Convert-HoloAssistantWindowsPathToWsl -Path $WorkingDirectory
            $commandParts += "cd $(Get-HoloAssistantShellQuotedValue $wslDir)"
        }
        if ($env:DATABASE_PASSWORD) {
            $commandParts += "export DATABASE_PASSWORD=$(Get-HoloAssistantShellQuotedValue $env:DATABASE_PASSWORD)"
        }
        $commandParts += "export HOLO_ASSISTANT_POSTGRES_PORT_MAPPING='5432:5432'"
        $commandParts += "export HOLO_ASSISTANT_ADMINER_PORT_MAPPING='8080:8080'"
        $joinedArgs = ($Arguments | ForEach-Object { Get-HoloAssistantShellQuotedValue $_ }) -join " "
        $commandParts += "docker $joinedArgs"
        $command = $commandParts -join "; "
        $distroName = Get-HoloAssistantWslDistributionName
        if (-not $distroName) {
            throw "Nessuna distribuzione WSL selezionata per eseguire Docker."
        }
        $result = Invoke-HoloAssistantCapturedTool -FilePath "wsl.exe" -Arguments @("-d", $distroName, "--", "bash", "-lc", $command)
        if ($result.Output) {
            $result.Output | ForEach-Object { Write-Host $_ }
        }
        if ($AllowFailure) {
            return $result.ExitCode
        }
        if ($result.ExitCode -ne 0) {
            throw "$(Get-HoloAssistantDockerFailureMessage -FailureMessage $FailureMessage -Output $result.Output) Exit code: $($result.ExitCode)"
        }
        return
    }

    Use-HoloAssistantWritableDockerConfig
    $result = Invoke-HoloAssistantCapturedTool -FilePath "docker" -Arguments $Arguments -WorkingDirectory $WorkingDirectory
    if ($result.ExitCode -eq 0) {
        if ($result.Output) {
            $result.Output | ForEach-Object { Write-Host $_ }
        }
        if ($AllowFailure) {
            return 0
        }
        return
    }

    if ($AllowFailure) {
        return $result.ExitCode
    }

    throw "$(Get-HoloAssistantDockerFailureMessage -FailureMessage $FailureMessage -Output $result.Output) Exit code: $($result.ExitCode)"
}

function Invoke-HoloAssistantCapturedTool {
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
        $output = @(& $FilePath @Arguments 2>&1 | ForEach-Object { Convert-HoloAssistantConsoleText $_.ToString() })
        return @{ ExitCode = $LASTEXITCODE; Output = $output }
    } finally {
        $ErrorActionPreference = $oldErrorActionPreference
        Set-Location $oldLocation
    }
}

function Test-HoloAssistantDockerEngineError {
    param([string[]]$Output = @())

    $text = ($Output -join "`n")
    return $text -match "dockerDesktopLinuxEngine" -or
        $text -match "docker_engine" -or
        $text -match "failed to connect to the docker API" -or
        $text -match "daemon is not running" -or
        $text -match "Cannot connect to the Docker daemon" -or
        $text -match "The system cannot find the file specified"
}

function Get-HoloAssistantDockerFailureMessage {
    param(
        [Parameter(Mandatory=$true)][string]$FailureMessage,
        [string[]]$Output = @()
    )

    if (Test-HoloAssistantDockerEngineError -Output $Output) {
        return "$FailureMessage Docker non risponde dal lato Windows. Lo script puo' usare Docker nativo se gia' pronto, altrimenti prepara WSL2 e Docker Engine nella distro selezionata."
    }

    if ($Output) {
        return "$FailureMessage $($Output -join ' ')"
    }
    return $FailureMessage
}

function Install-HoloAssistantWingetPackage {
    param(
        [Parameter(Mandatory=$true)][string]$PackageId,
        [string[]]$FallbackPackageIds = @(),
        [Parameter(Mandatory=$true)][string]$DisplayName,
        [switch]$CheckOnly
    )

    if ($CheckOnly) {
        Write-HoloAssistantWarn "$DisplayName non e' disponibile. CheckOnly: salto installazione automatica."
        return $false
    }

    if (-not (Test-HoloAssistantCommand "winget")) {
        Write-HoloAssistantError "$DisplayName non e' disponibile e winget non e' nel PATH."
        Write-HoloAssistantInfo "Installa App Installer dal Microsoft Store, poi rilancia lo script."
        Write-HoloAssistantInfo "In alternativa installa manualmente: $DisplayName"
        return $false
    }

    $ids = @($PackageId) + $FallbackPackageIds
    foreach ($id in $ids) {
        Write-HoloAssistantInfo "Provo a installare $DisplayName con winget ($id)..."
        $exitCode = Invoke-HoloAssistantTool -FilePath "winget" -Arguments @("install", "-e", "--id", $id, "--accept-package-agreements", "--accept-source-agreements")
        Update-HoloAssistantPath
        if ($exitCode -eq 0) {
            Write-HoloAssistantOk "$DisplayName installato o gia' presente."
            return $true
        }
        Write-HoloAssistantWarn "Installazione winget fallita per $id."
    }

    Write-HoloAssistantError "Non sono riuscito a installare $DisplayName automaticamente."
    return $false
}

function Ensure-HoloAssistantCommand {
    param(
        [Parameter(Mandatory=$true)][string]$CommandName,
        [Parameter(Mandatory=$true)][string]$DisplayName,
        [string]$PackageId = "",
        [string[]]$FallbackPackageIds = @(),
        [switch]$CheckOnly
    )

    if (Test-HoloAssistantCommand $CommandName) {
        Write-HoloAssistantOk "$DisplayName disponibile."
        return $true
    }

    if (-not $PackageId) {
        Write-HoloAssistantError "$DisplayName non trovato nel PATH."
        return $false
    }

    $installed = Install-HoloAssistantWingetPackage -PackageId $PackageId -FallbackPackageIds $FallbackPackageIds -DisplayName $DisplayName -CheckOnly:$CheckOnly
    if (-not $installed) {
        return $false
    }

    Update-HoloAssistantPath
    if (Test-HoloAssistantCommand $CommandName) {
        Write-HoloAssistantOk "$DisplayName ora disponibile."
        return $true
    }

    Write-HoloAssistantError "$DisplayName risulta installato, ma non e' ancora disponibile nel PATH di questa finestra."
    Write-HoloAssistantInfo "Chiudi e riapri il terminale, poi rilancia lo script."
    return $false
}

function Get-HoloAssistantPythonCommand {
    param([switch]$CheckOnly)

    if (Test-HoloAssistantCommand "py") {
        return @{ Exe = "py"; Args = @("-3") }
    }
    if (Test-HoloAssistantCommand "python") {
        return @{ Exe = "python"; Args = @() }
    }

    $installed = Install-HoloAssistantWingetPackage -PackageId "Python.Python.3.13" -FallbackPackageIds @("Python.Python.3.12") -DisplayName "Python 3" -CheckOnly:$CheckOnly
    if ($installed) {
        Update-HoloAssistantPath
        if (Test-HoloAssistantCommand "py") {
            return @{ Exe = "py"; Args = @("-3") }
        }
        if (Test-HoloAssistantCommand "python") {
            return @{ Exe = "python"; Args = @() }
        }
    }

    throw "Python 3 non trovato. Installa Python 3.12+ oppure abilita winget e rilancia."
}

function Invoke-HoloAssistantPython {
    param(
        [Parameter(Mandatory=$true)][hashtable]$Python,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = "",
        [string]$FailureMessage = "Comando Python fallito."
    )

    Invoke-HoloAssistantToolChecked -FilePath $Python.Exe -Arguments (@($Python.Args) + $Arguments) -WorkingDirectory $WorkingDirectory -FailureMessage $FailureMessage
}

function Get-HoloAssistantLocalIp {
    try {
        $defaultRoute = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix "0.0.0.0/0" -ErrorAction Stop |
            Sort-Object RouteMetric, InterfaceMetric |
            Select-Object -First 1
        if ($defaultRoute) {
            $adapter = Get-NetAdapter -InterfaceIndex $defaultRoute.InterfaceIndex -ErrorAction Stop
            if (-not (Test-HoloAssistantVirtualAdapterName -Name $adapter.Name) -and -not (Test-HoloAssistantVirtualAdapterName -Name $adapter.InterfaceDescription)) {
                $routeIp = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $defaultRoute.InterfaceIndex -ErrorAction Stop |
                    Where-Object { Test-HoloAssistantUsableIpv4 -IpAddress $_.IPAddress } |
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
                (Test-HoloAssistantUsableIpv4 -IpAddress $_.IPAddress) -and
                -not (Test-HoloAssistantVirtualAdapterName -Name $_.InterfaceAlias)
            } |
            Select-Object -First 1 -ExpandProperty IPAddress
        if ($ip) {
            return $ip
        }
    } catch {
    }

    $ipconfigCandidates = Get-HoloAssistantIpconfigCandidates
    $preferred = $ipconfigCandidates |
        Where-Object { -not (Test-HoloAssistantVirtualAdapterName -Name $_.AdapterName) -and (Test-HoloAssistantUsableIpv4 -IpAddress $_.IPAddress) } |
        Select-Object -First 1
    if ($preferred) {
        return $preferred.IPAddress
    }

    $fallback = $ipconfigCandidates |
        Where-Object { Test-HoloAssistantUsableIpv4 -IpAddress $_.IPAddress } |
        Select-Object -First 1
    if ($fallback) {
        return $fallback.IPAddress
    }

    return "localhost"
}

function Get-HoloAssistantIpconfigCandidates {
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

function Test-HoloAssistantUsableIpv4 {
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

function Test-HoloAssistantVirtualAdapterName {
    param([string]$Name)

    if (-not $Name) {
        return $false
    }

    return $Name -match "(?i)wsl|docker|vEthernet|Hyper-V|Loopback|Bluetooth|VMware|VirtualBox|Tailscale|ZeroTier"
}

function Read-HoloAssistantEnvFile {
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

function Set-HoloAssistantEnvValues {
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

function Get-HoloAssistantWslDistributions {
    $result = Invoke-HoloAssistantCapturedTool -FilePath "wsl.exe" -Arguments @("--list", "--quiet")
    if ($result.ExitCode -ne 0) {
        return @()
    }
    $distros = @($result.Output | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() })
    return ,$distros
}

function Get-HoloAssistantWslRunningDistributions {
    $result = Invoke-HoloAssistantCapturedTool -FilePath "wsl.exe" -Arguments @("--list", "--running", "--quiet")
    if ($result.ExitCode -ne 0) {
        return @()
    }
    $distros = @($result.Output | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() })
    return ,$distros
}

function Get-HoloAssistantWslPrimaryIp {
    param([string]$DistroName = "")

    if (-not $DistroName) {
        $DistroName = Get-HoloAssistantWslDistributionName
    }
    if (-not $DistroName) {
        return ""
    }

    $result = Invoke-HoloAssistantCapturedTool -FilePath "wsl.exe" -Arguments @("-d", $DistroName, "--", "bash", "-lc", "hostname -I | cut -d' ' -f1")
    if ($result.ExitCode -ne 0) {
        return ""
    }

    return (($result.Output | Select-Object -First 1).Trim())
}

function Get-HoloAssistantDatabaseHost {
    return "127.0.0.1"
}

function Get-HoloAssistantDatabaseHostCandidates {
    $candidates = @("127.0.0.1", "localhost")

    if ($env:HOLO_ASSISTANT_DOCKER_MODE -eq "wsl") {
        $distroName = Get-HoloAssistantWslDistributionName
        if (-not $distroName) {
            throw "Docker e configurato in modalita WSL ma non risulta selezionata alcuna distribuzione WSL."
        }

        $wslIp = Get-HoloAssistantWslPrimaryIp -DistroName $distroName
        if (-not $wslIp) {
            Write-HoloAssistantWarn "Docker e in modalita WSL ma non riesco a determinare l'IP della distro '$distroName'. Provero' solo loopback Windows."
            return ,$candidates
        }

        if ($candidates -notcontains $wslIp) {
            $candidates += $wslIp
        }
    }

    return ,$candidates
}

function Resolve-HoloAssistantReachableDatabaseHost {
    param(
        [int]$Port = 5432,
        [int]$MaxAttemptsPerCandidate = 4
    )

    $candidates = Get-HoloAssistantDatabaseHostCandidates
    Write-HoloAssistantInfo "Host database candidati dal lato Windows (preferenza: localhost/127.0.0.1): $($candidates -join ', ')"

    foreach ($candidate in $candidates) {
        if (Wait-HoloAssistantTcpPort -TargetHost $candidate -Port $Port -MaxAttempts $MaxAttemptsPerCandidate) {
            return $candidate
        }
    }

    throw "PostgreSQL non e raggiungibile da Windows su nessuno degli host candidati: $($candidates -join ', ')."
}

function Ensure-HoloAssistantWslDistroForDocker {
    param(
        [string]$PreferredDistro = $HoloAssistantWslInstallBaseDistro,
        [string]$CustomDistroName = $HoloAssistantWslDedicatedDistro,
        [switch]$CheckOnly
    )

    $existingDistros = Get-HoloAssistantWslDistributions

    if ($existingDistros.Count -gt 0) {
        $selectedDistro = $existingDistros[0]
        Set-HoloAssistantWslDistributionName -Name $selectedDistro
        Write-HoloAssistantInfo "Trovata una distro WSL esistente. Uso la prima disponibile: $selectedDistro"
        return $selectedDistro
    }

    if ($CheckOnly) {
        Write-HoloAssistantInfo "CheckOnly: nessuna distribuzione WSL trovata"
        return $null
    }
    
    # Crea nuova distribuzione dedicata
    Write-HoloAssistantInfo "Creazione nuova distribuzione WSL dedicata: $CustomDistroName"
    Write-Host ""
    Write-Host "========================================"
    Write-Host "   CONFIGURAZIONE NUOVA DISTRIBUZIONE WSL"
    Write-Host "========================================"
    Write-Host ""
    Write-Host "Verra creata una nuova distribuzione Linux chiamata '$CustomDistroName'."
    Write-Host "Completa la configurazione quando richiesto:"
    Write-Host "  1. Inserisci un username (es. holo-assistant-user)"
    Write-Host "  2. Inserisci una password"
    Write-Host "  3. Conferma la password"
    Write-Host "Dopo la conferma della password tornerai automaticamente al setup."
    $installArgs = @("--install", "--web-download", "--no-launch", "--distribution", $PreferredDistro, "--name", $CustomDistroName)
    $process = Start-Process -FilePath "wsl.exe" -ArgumentList $installArgs -NoNewWindow -Wait -PassThru
    
    if ($process.ExitCode -ne 0) {
        throw "Installazione distribuzione WSL fallita."
    }

    Write-HoloAssistantInfo "Avvio iniziale di $CustomDistroName per completare la creazione dell'utente Linux..."
    $firstLaunch = Start-Process -FilePath "wsl.exe" -ArgumentList @("-d", $CustomDistroName, "--", "sh", "-lc", "exit 0") -NoNewWindow -Wait -PassThru
    if ($firstLaunch.ExitCode -ne 0) {
        throw "Inizializzazione della distribuzione $CustomDistroName fallita."
    }

    Write-Host ""
    Read-Host "Configurazione Linux completata. Premi INVIO per continuare con l'installazione di Docker"

    $newDistros = Get-HoloAssistantWslDistributions
    if ($newDistros -notcontains $CustomDistroName) {
        throw "Distribuzione $CustomDistroName non trovata dopo l'installazione."
    }

    Set-HoloAssistantWslDistributionName -Name $CustomDistroName
    return $CustomDistroName
}

function Ensure-HoloAssistantDockerInWsl {
    param(
        [Parameter(Mandatory=$true)][string]$DistroName,
        [switch]$CheckOnly
    )

    if ($CheckOnly) {
        $checkCommand = "command -v docker >/dev/null 2>&1 && (docker compose version >/dev/null 2>&1 || sudo docker compose version >/dev/null 2>&1)"
        $check = Invoke-HoloAssistantCapturedTool -FilePath "wsl.exe" -Arguments @("-d", $DistroName, "--", "bash", "-lc", $checkCommand)
        return $check.ExitCode -eq 0
    }

$dockerInstallScript = @'
set -e
export DEBIAN_FRONTEND=noninteractive
echo "[WSL] Installazione Docker: potrebbe essere richiesta la password dell'utente Linux per sudo."
echo "[WSL] Se il setup sembra fermo, inserisci la password Linux e premi INVIO."
echo "[WSL] La password non verra mostrata mentre scrivi: e normale."
sudo -p "[WSL] Password Linux richiesta per sudo: " -v
if ! command -v docker >/dev/null 2>&1; then
    echo "[WSL] Aggiorno gli indici apt..."
    sudo apt-get update
    echo "[WSL] Installo dipendenze base..."
    sudo apt-get install -y ca-certificates curl
    echo "[WSL] Preparo repository ufficiale Docker..."
    sudo install -m 0755 -d /etc/apt/keyrings
    sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    sudo chmod a+r /etc/apt/keyrings/docker.asc
    sudo rm -f /etc/apt/sources.list.d/docker.list
    . /etc/os-release
    arch=$(dpkg --print-architecture)
    printf '%s\n' "deb [arch=$arch signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    echo "[WSL] Aggiorno gli indici apt con il repository Docker..."
    sudo apt-get update
    echo "[WSL] Installo Docker Engine e Compose plugin..."
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    echo "[WSL] Aggiungo l'utente corrente al gruppo docker..."
    sudo usermod -aG docker $USER || true
else
    echo "[WSL] Docker e gia installato, salto l'installazione dei pacchetti."
fi
echo "[WSL] Avvio il servizio Docker..."
sudo service docker start || sudo systemctl start docker || true
echo "[WSL] Verifico che Docker risponda..."
(docker info >/dev/null 2>&1 || sudo docker info >/dev/null 2>&1)
(docker compose version >/dev/null 2>&1 || sudo docker compose version >/dev/null 2>&1)
echo "[WSL] Docker pronto nella distro."
'@

    Write-HoloAssistantInfo "Installazione Docker in $DistroName (potrebbe richiedere alcuni minuti)..."
    Write-HoloAssistantInfo "Se dopo questa riga sembra fermo, molto probabilmente WSL sta aspettando la password Linux per sudo."
    $dockerInstallScriptBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($dockerInstallScript))
    $bootstrapCommand = "printf '%s' $dockerInstallScriptBase64 | base64 -d | bash"
    $result = Invoke-HoloAssistantCapturedTool -FilePath "wsl.exe" -Arguments @("-d", $DistroName, "--", "bash", "-lc", $bootstrapCommand)
    
    if ($result.ExitCode -ne 0) {
        Write-HoloAssistantError "Installazione Docker fallita."
        if ($result.Output) {
            $result.Output | ForEach-Object { Write-Host $_ }
        }
        return $false
    }
    
    Write-HoloAssistantOk "Docker installato in $DistroName"
    return $true
}

function New-HoloAssistantBackendEnv {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$Ip,
        [Parameter(Mandatory=$true)][hashtable]$OllamaConfig,
        [string]$DatabaseHost = "",
        [int]$FrontendPort = $HoloAssistantDefaultFrontendPort
    )

    if (-not $DatabaseHost) {
        $DatabaseHost = Get-HoloAssistantDatabaseHost
    }

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
        "DATABASE_HOST=$DatabaseHost",
        "DATABASE_PORT=5432",
        "DATABASE_USER=postgres",
        "DATABASE_PASSWORD=$databasePassword",
        "DATABASE_NAME=holo_assistant_db",
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

function Get-HoloAssistantOllamaConfig {
    param([Parameter(Mandatory=$true)][string]$BackendEnvPath)

    $envValues = Read-HoloAssistantEnvFile -Path $BackendEnvPath
    return @{
        Model = $(if ($envValues["OLLAMA_MODEL"]) { $envValues["OLLAMA_MODEL"] } else { $HoloAssistantDefaultOllamaModel })
        BaseUrl = $HoloAssistantDefaultOllamaBaseUrl
        Runtime = "native"
        Accelerator = $(if ($envValues["OLLAMA_ACCELERATOR"]) { $envValues["OLLAMA_ACCELERATOR"] } else { "auto" })
        NativeVulkan = $(if ($envValues["OLLAMA_NATIVE_VULKAN"]) { $envValues["OLLAMA_NATIVE_VULKAN"] } elseif ($envValues["OLLAMA_VULKAN"]) { $envValues["OLLAMA_VULKAN"] } else { "1" })
        KeepAlive = $(if ($envValues["OLLAMA_KEEP_ALIVE"]) { $envValues["OLLAMA_KEEP_ALIVE"] } else { "30m" })
        TopK = $(if ($envValues["OLLAMA_TOP_K"]) { $envValues["OLLAMA_TOP_K"] } else { "20" })
        TopP = $(if ($envValues["OLLAMA_TOP_P"]) { $envValues["OLLAMA_TOP_P"] } else { "0.8" })
        NumCtx = $(if ($envValues["OLLAMA_NUM_CTX"]) { $envValues["OLLAMA_NUM_CTX"] } else { "2048" })
        NumThread = $(if ($envValues["OLLAMA_NUM_THREAD"]) { $envValues["OLLAMA_NUM_THREAD"] } else { "4" })
    }
}

function Get-HoloAssistantOllamaRuntime {
    param(
        [Parameter(Mandatory=$true)][hashtable]$Config,
        [switch]$CheckOnly
    )

    if (Test-HoloAssistantCommand "ollama") {
        Write-HoloAssistantInfo "Runtime Ollama Windows: nativo."
        return @{ UseNative = $true; ComposeArgs = @("-f", "docker-compose.yml") }
    }

    if (-not (Invoke-HoloAssistantOllamaInstallScript -CheckOnly:$CheckOnly)) {
        throw "Ollama nativo non disponibile."
    }
    Update-HoloAssistantPath
    if (-not (Test-HoloAssistantCommand "ollama")) {
        throw "Ollama risulta installato ma non e' ancora disponibile nel PATH di questa finestra."
    }

    return @{ UseNative = $true; ComposeArgs = @("-f", "docker-compose.yml") }
}

function Ensure-HoloAssistantDocker {
    param(
        [switch]$CheckOnly
    )

    $env:HOLO_ASSISTANT_DOCKER_MODE = ""
    $direct = Test-HoloAssistantDockerDirectReady
    if ($direct.Ready) {
        $env:HOLO_ASSISTANT_DOCKER_MODE = "windows"
        Write-HoloAssistantOk "Docker disponibile nel runtime Windows corrente."
        return
    }

    $wslStatus = Get-HoloAssistantWslStatus
    Write-HoloAssistantInfo "Stato WSL: $($wslStatus.Summary)"

    if ($CheckOnly) {
        $wslDocker = Test-HoloAssistantDockerInWslReady
        Write-HoloAssistantInfo "CheckOnly: Docker Windows pronto: $($direct.Ready)"
        Write-HoloAssistantInfo "CheckOnly: Docker via WSL pronto: $($wslDocker.Ready)"
        if ($wslDocker.DistroName) {
            Write-HoloAssistantInfo "CheckOnly: distribuzione WSL selezionata: $($wslDocker.DistroName)"
        }
        return
    }

    if ($wslStatus.RebootRequired) {
        throw "WSL richiede un riavvio di Windows prima di completare il setup Docker."
    }

    $distro = Ensure-HoloAssistantWslDocker

    $wslDocker = Test-HoloAssistantDockerInWslReady
    if (-not $wslDocker.Ready) {
        throw "Docker in WSL non risponde ancora. Verifica $distro e il daemon Docker, poi rilancia lo script."
    }
}

function Test-HoloAssistantNeedsWindowsAdminForDockerBootstrap {
    param([switch]$CheckOnly)

    if ($CheckOnly -or (Test-HoloAssistantIsAdmin)) {
        return $false
    }

    $direct = Test-HoloAssistantDockerDirectReady
    if ($direct.Ready) {
        return $false
    }

    $wslStatus = Get-HoloAssistantWslStatus
    if (-not $wslStatus.IsInstalled) {
        return $true
    }

    if (-not $wslStatus.IsAccessible) {
        return $true
    }

    return $false
}

function Start-HoloAssistantScriptElevated {
    param(
        [Parameter(Mandatory=$true)][string]$ScriptPath,
        [string[]]$ScriptArguments = @()
    )

    $argumentList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$ScriptPath`"")
    foreach ($arg in $ScriptArguments) {
        $argumentList += "`"$arg`""
    }

    Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList ($argumentList -join " ")
}

function Use-HoloAssistantWritableDockerConfig {
    if ($env:HOLO_ASSISTANT_DOCKER_CONFIG_READY -eq "1") {
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
        $fallbackDir = Join-Path $env:TEMP "holo-assistant-docker-config"
        New-Item -ItemType Directory -Force -Path $fallbackDir | Out-Null
        $env:DOCKER_CONFIG = $fallbackDir
        Write-HoloAssistantWarn "Docker config utente non leggibile: uso DOCKER_CONFIG temporaneo per questa sessione."
    }
    $env:HOLO_ASSISTANT_DOCKER_CONFIG_READY = "1"
}

function Ensure-HoloAssistantHttpsCertificate {
    param(
        [Parameter(Mandatory=$true)][string]$RootDir,
        [Parameter(Mandatory=$true)][string]$Ip,
        [switch]$CheckOnly
    )

    $certFile = Join-Path $RootDir "certs\holo-assistant.crt"
    $keyFile = Join-Path $RootDir "certs\holo-assistant.key"
    if ((Test-Path $certFile) -and (Test-Path $keyFile)) {
        Write-HoloAssistantOk "HTTPS attivo con certificato: $certFile"
        return @{ CertFile = $certFile; KeyFile = $keyFile }
    }

    Ensure-HoloAssistantCommand -CommandName "mkcert" -DisplayName "mkcert" -PackageId "FiloSottile.mkcert" -CheckOnly:$CheckOnly | Out-Null
    if ($CheckOnly) {
        Write-HoloAssistantInfo "CheckOnly: non genero certificati HTTPS."
        return @{ CertFile = $certFile; KeyFile = $keyFile }
    }

    if (-not (Test-HoloAssistantCommand "mkcert")) {
        throw "mkcert non disponibile."
    }

    $certDir = Join-Path $RootDir "certs"
    New-Item -ItemType Directory -Force -Path $certDir | Out-Null
    Write-HoloAssistantInfo "Genero certificato HTTPS per $Ip, localhost, 127.0.0.1 e holo-assistant.lan..."
    Invoke-HoloAssistantToolChecked -FilePath "mkcert" -Arguments @("-cert-file", $certFile, "-key-file", $keyFile, $Ip, "localhost", "127.0.0.1", "holo-assistant.lan") -FailureMessage "Generazione certificato HTTPS fallita."

    if (-not (Test-Path $certFile) -or -not (Test-Path $keyFile)) {
        throw "Certificato HTTPS non creato correttamente."
    }
    Write-HoloAssistantOk "Certificato HTTPS generato."
    return @{ CertFile = $certFile; KeyFile = $keyFile }
}

function Wait-HoloAssistantPostgres {
    param([int]$MaxAttempts = 30)

    Write-HoloAssistantInfo "Attendo che PostgreSQL sia pronto..."
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        $exitCode = Invoke-HoloAssistantDocker -Arguments @("exec", "holo_assistant_postgres", "pg_isready", "-U", "postgres") -AllowFailure
        if ($exitCode -eq 0) {
            Write-HoloAssistantOk "PostgreSQL e' pronto."
            return $true
        }
        if ($attempt -eq 1 -or $attempt % 5 -eq 0) {
            Write-HoloAssistantInfo "PostgreSQL non e' ancora pronto, continuo ad aspettare..."
        }
        Start-Sleep -Seconds 2
    }
    Write-HoloAssistantWarn "PostgreSQL potrebbe non essere ancora pronto."
    return $false
}

function Wait-HoloAssistantPostgresHealthy {
    param([int]$MaxAttempts = 30)

    Write-HoloAssistantInfo "Attendo che il container PostgreSQL diventi healthy..."
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        $result = Invoke-HoloAssistantCapturedDocker -Arguments @("inspect", "-f", "{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}", "holo_assistant_postgres")
        if ($result.ExitCode -eq 0) {
            $health = (($result.Output | Select-Object -First 1).Trim())
            if ($health -eq "healthy") {
                Write-HoloAssistantOk "Container PostgreSQL healthy."
                return $true
            }
            if ($attempt -eq 1 -or $attempt % 5 -eq 0) {
                Write-HoloAssistantInfo "Stato health PostgreSQL corrente: $health"
            }
        }
        Start-Sleep -Seconds 2
    }

    Write-HoloAssistantWarn "Il container PostgreSQL non e diventato healthy in tempo."
    return $false
}

function Wait-HoloAssistantTcpPort {
    param(
        [string]$TargetHost = "127.0.0.1",
        [int]$Port,
        [int]$MaxAttempts = 30
    )

    Write-HoloAssistantInfo "Attendo che $TargetHost`:$Port sia raggiungibile dal lato Windows..."
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        $client = $null
        try {
            $client = [System.Net.Sockets.TcpClient]::new()
            $asyncResult = $client.BeginConnect($TargetHost, $Port, $null, $null)
            if ($asyncResult.AsyncWaitHandle.WaitOne(1000, $false)) {
                $client.EndConnect($asyncResult)
                Write-HoloAssistantOk "$TargetHost`:$Port raggiungibile."
                return $true
            }
        } catch {
        } finally {
            if ($client) {
                $client.Dispose()
            }
        }

        if ($attempt -eq 1 -or $attempt % 5 -eq 0) {
            Write-HoloAssistantInfo "La porta $TargetHost`:$Port non e ancora raggiungibile, continuo ad aspettare..."
        }
        Start-Sleep -Seconds 2
    }

    Write-HoloAssistantWarn "La porta $TargetHost`:$Port non risulta raggiungibile."
    return $false
}

function Invoke-HoloAssistantCapturedDocker {
    param(
        [string[]]$Arguments,
        [string]$WorkingDirectory = ""
    )

    if ($env:HOLO_ASSISTANT_DOCKER_MODE -eq "wsl") {
        $commandParts = @()
        if ($WorkingDirectory) {
            $wslDir = Convert-HoloAssistantWindowsPathToWsl -Path $WorkingDirectory
            $commandParts += "cd $(Get-HoloAssistantShellQuotedValue $wslDir)"
        }
        if ($env:DATABASE_PASSWORD) {
            $commandParts += "export DATABASE_PASSWORD=$(Get-HoloAssistantShellQuotedValue $env:DATABASE_PASSWORD)"
        }
        $commandParts += "export HOLO_ASSISTANT_POSTGRES_PORT_MAPPING='5432:5432'"
        $commandParts += "export HOLO_ASSISTANT_ADMINER_PORT_MAPPING='8080:8080'"
        $joinedArgs = ($Arguments | ForEach-Object { Get-HoloAssistantShellQuotedValue $_ }) -join " "
        $commandParts += "docker $joinedArgs"
        $command = ($commandParts -join " && ")
        $distroName = Get-HoloAssistantWslDistributionName
        return Invoke-HoloAssistantCapturedTool -FilePath "wsl.exe" -Arguments @("-d", $distroName, "--", "bash", "-lc", $command)
    }

    Use-HoloAssistantWritableDockerConfig
    return Invoke-HoloAssistantCapturedTool -FilePath "docker" -Arguments $Arguments -WorkingDirectory $WorkingDirectory
}

function Show-HoloAssistantPostgresDiagnostics {
    param([string]$DockerDir = "")

    Write-HoloAssistantWarn "Raccolgo diagnostica PostgreSQL..."
    Invoke-HoloAssistantDocker -Arguments @("compose", "-f", "docker-compose.yml", "ps") -WorkingDirectory $DockerDir -FailureMessage "Diagnostica docker compose ps fallita." -AllowFailure | Out-Null
    Invoke-HoloAssistantDocker -Arguments @("compose", "-f", "docker-compose.yml", "logs", "--tail", "120", "postgres") -WorkingDirectory $DockerDir -FailureMessage "Diagnostica log postgres fallita." -AllowFailure | Out-Null
}

function Test-HoloAssistantHttp {
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

function Ensure-HoloAssistantNativeOllama {
    param(
        [Parameter(Mandatory=$true)][hashtable]$Config,
        [switch]$CheckOnly
    )

    if (-not (Test-HoloAssistantCommand "ollama")) {
        $installed = Invoke-HoloAssistantOllamaInstallScript -CheckOnly:$CheckOnly
        if ($installed) {
            Update-HoloAssistantPath
        }
    }
    if ($CheckOnly) {
        Write-HoloAssistantInfo "CheckOnly: non avvio Ollama nativo."
        return
    }

    if (-not (Test-HoloAssistantCommand "ollama")) {
        throw "Ollama nativo non disponibile."
    }

    if (Test-HoloAssistantHttp -Url "$($Config.BaseUrl)/api/tags") {
        Write-HoloAssistantOk "Ollama nativo raggiungibile."
        return
    }

    Write-HoloAssistantInfo "Avvio Ollama nativo in background..."
    Start-Process -FilePath "cmd.exe" -ArgumentList @("/k", "set OLLAMA_VULKAN=$($Config.NativeVulkan) && ollama serve") -WindowStyle Normal | Out-Null
    for ($attempt = 1; $attempt -le 20; $attempt++) {
        Start-Sleep -Seconds 2
        if (Test-HoloAssistantHttp -Url "$($Config.BaseUrl)/api/tags") {
            Write-HoloAssistantOk "Ollama nativo raggiungibile."
            return
        }
    }
    Write-HoloAssistantWarn "Ollama nativo non risponde ancora su $($Config.BaseUrl)."
}

function Ensure-HoloAssistantOllamaModel {
    param(
        [Parameter(Mandatory=$true)][hashtable]$Config,
        [Parameter(Mandatory=$true)][hashtable]$Runtime,
        [switch]$CheckOnly
    )

    if ($CheckOnly) {
        Write-HoloAssistantInfo "CheckOnly: non controllo ne' scarico il modello Ollama."
        return
    }

    Write-HoloAssistantInfo "Preparazione modello AI: $($Config.Model)"
    Ensure-HoloAssistantNativeOllama -Config $Config
    $models = @(ollama list 2>$null)
    if (-not ($models | Select-String -SimpleMatch $Config.Model)) {
        Write-HoloAssistantInfo "Modello non trovato in Ollama nativo. Inizio download con ollama pull..."
        Invoke-HoloAssistantToolChecked -FilePath "ollama" -Arguments @("pull", $Config.Model) -FailureMessage "Pull modello Ollama nativo fallito."
    }
    Write-HoloAssistantOk "Modello $($Config.Model) pronto su Ollama nativo."
}

function Invoke-HoloAssistantOllamaWarmup {
    param(
        [Parameter(Mandatory=$true)][hashtable]$Config,
        [switch]$CheckOnly
    )

    if ($CheckOnly) {
        Write-HoloAssistantInfo "CheckOnly: salto warmup Ollama."
        return
    }

    Write-HoloAssistantInfo "Attendo che Ollama risponda su $($Config.BaseUrl)..."
    $ready = $false
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        if (Test-HoloAssistantHttp -Url "$($Config.BaseUrl)/api/tags" -TimeoutSeconds 5) {
            $ready = $true
            break
        }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) {
        Write-HoloAssistantWarn "Ollama non risponde ancora all'endpoint /api/tags."
        return
    }

    Write-HoloAssistantInfo "Warmup modello AI in corso..."
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
        Write-HoloAssistantOk "Modello AI pronto."
    } catch {
        Write-HoloAssistantWarn "Warmup Ollama non completato. Il primo prompt potrebbe essere piu' lento."
    }
}

function Ensure-HoloAssistantBackendDependencies {
    param(
        [Parameter(Mandatory=$true)][string]$BackendDir,
        [Parameter(Mandatory=$true)][hashtable]$Python,
        [switch]$CheckOnly
    )

    $venvDir = Join-Path $BackendDir "venv"
    if ($CheckOnly) {
        Write-HoloAssistantInfo "CheckOnly: verifico solo se venv esiste: $([bool](Test-Path $venvDir))"
        return
    }

    if (-not (Test-Path $venvDir)) {
        Write-HoloAssistantInfo "Creo ambiente virtuale backend..."
        Invoke-HoloAssistantPython -Python $Python -Arguments @("-m", "venv", "venv") -WorkingDirectory $BackendDir -FailureMessage "Creazione venv fallita."
    }

    $venvPython = Join-Path $venvDir "Scripts\python.exe"
    if (-not (Test-Path $venvPython)) {
        throw "Python del virtualenv non trovato: $venvPython"
    }

    Ensure-HoloAssistantPipCurrent -VenvPython $venvPython -BackendDir $BackendDir

    if (Test-Path (Join-Path $BackendDir "requirements.txt")) {
        Write-HoloAssistantInfo "Installo dipendenze Python del backend da requirements.txt. Questa fase puo' richiedere un po' di tempo..."
        Invoke-HoloAssistantToolChecked -FilePath $venvPython -Arguments @("-m", "pip", "install", "-r", "requirements.txt", "--quiet") -WorkingDirectory $BackendDir -FailureMessage "Installazione dipendenze Python fallita."
    } else {
        Write-HoloAssistantWarn "requirements.txt non trovato, installo dipendenze base."
        Invoke-HoloAssistantToolChecked -FilePath $venvPython -Arguments @("-m", "pip", "install", "fastapi", "uvicorn", "sqlalchemy", "psycopg2-binary", "python-jose[cryptography]", "passlib[bcrypt]", "python-multipart", "python-dotenv", "requests", "--quiet") -WorkingDirectory $BackendDir -FailureMessage "Installazione dipendenze Python base fallita."
    }
}

function Ensure-HoloAssistantPipCurrent {
    param(
        [Parameter(Mandatory=$true)][string]$VenvPython,
        [Parameter(Mandatory=$true)][string]$BackendDir
    )

    $before = Get-HoloAssistantPipVersion -VenvPython $VenvPython -BackendDir $BackendDir
    if ($before) {
        Write-HoloAssistantInfo "Verifico pip (versione attuale: $before)..."
    } else {
        Write-HoloAssistantInfo "Verifico pip..."
    }

    $upgrade = Invoke-HoloAssistantCapturedTool -FilePath $VenvPython -Arguments @("-m", "pip", "install", "--upgrade", "pip", "--quiet", "--disable-pip-version-check") -WorkingDirectory $BackendDir
    if ($upgrade.ExitCode -ne 0) {
        Write-HoloAssistantWarn "Aggiornamento pip non completato; continuo con la versione installata."
        if ($upgrade.Output) {
            Write-HoloAssistantWarn ($upgrade.Output | Select-Object -Last 1)
        }
        return
    }

    $after = Get-HoloAssistantPipVersion -VenvPython $VenvPython -BackendDir $BackendDir
    if ($before -and $after -and $before -ne $after) {
        Write-HoloAssistantOk "pip aggiornato: $before -> $after"
    } elseif ($after) {
        Write-HoloAssistantOk "pip gia' aggiornato: $after"
    } else {
        Write-HoloAssistantOk "pip verificato."
    }
}

function Get-HoloAssistantPipVersion {
    param(
        [Parameter(Mandatory=$true)][string]$VenvPython,
        [Parameter(Mandatory=$true)][string]$BackendDir
    )

    $result = Invoke-HoloAssistantCapturedTool -FilePath $VenvPython -Arguments @("-m", "pip", "--version") -WorkingDirectory $BackendDir
    if ($result.ExitCode -ne 0 -or -not $result.Output) {
        return ""
    }

    $line = ($result.Output | Select-Object -First 1)
    if ($line -match "pip\s+([^\s]+)") {
        return $Matches[1]
    }
    return $line
}

function Ensure-HoloAssistantFrontendDependencies {
    param(
        [Parameter(Mandatory=$true)][string]$FrontendDir,
        [switch]$CheckOnly
    )

    Ensure-HoloAssistantCommand -CommandName "node" -DisplayName "Node.js" -PackageId "OpenJS.NodeJS.LTS" -CheckOnly:$CheckOnly | Out-Null
    Ensure-HoloAssistantCommand -CommandName "npm" -DisplayName "npm" -PackageId "OpenJS.NodeJS.LTS" -CheckOnly:$CheckOnly | Out-Null

    if ($CheckOnly) {
        Write-HoloAssistantInfo "CheckOnly: verifico solo se node_modules esiste: $([bool](Test-Path (Join-Path $FrontendDir "node_modules")))"
        return
    }

    if (-not (Test-HoloAssistantCommand "npm")) {
        throw "npm non disponibile."
    }

    if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
        Write-HoloAssistantInfo "Installo dipendenze Node.js del frontend. Questa fase puo' richiedere qualche minuto..."
        Invoke-HoloAssistantToolChecked -FilePath "npm" -Arguments @("install") -WorkingDirectory $FrontendDir -FailureMessage "Installazione dipendenze frontend fallita."
    } else {
        Write-HoloAssistantOk "Dipendenze Node.js gia' installate."
    }
}

function Test-HoloAssistantPiperVoiceModelPresent {
    param([Parameter(Mandatory=$true)][string]$BackendDir)

    $modelPath = Join-Path $BackendDir "app\services\voice_models\$HoloAssistantPiperDefaultVoiceModelFilename"
    $configPath = Join-Path $BackendDir "app\services\voice_models\$HoloAssistantPiperDefaultVoiceConfigFilename"
    return (Test-Path $modelPath) -and (Test-Path $configPath)
}

function Ensure-HoloAssistantPiperVoiceModel {
    param(
        [Parameter(Mandatory=$true)][string]$RootDir,
        [Parameter(Mandatory=$true)][string]$BackendDir,
        [switch]$CheckOnly
    )

    if (Test-HoloAssistantPiperVoiceModelPresent -BackendDir $BackendDir) {
        Write-HoloAssistantOk "Modello Piper gia' presente."
        return
    }

    if ($CheckOnly) {
        Write-HoloAssistantInfo "CheckOnly: modello Piper presente: False"
        return
    }

    Write-HoloAssistantInfo "Preparo voce Piper predefinita..."
    Invoke-HoloAssistantToolChecked -FilePath "powershell.exe" -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $RootDir "scripts\windows\prepare_piper_model.ps1")) -FailureMessage "Preparazione modello Piper fallita."
}

function Start-HoloAssistantCmdWindow {
    param(
        [Parameter(Mandatory=$true)][string]$Title,
        [Parameter(Mandatory=$true)][string]$Command
    )

    Start-Process -FilePath "cmd.exe" -ArgumentList @("/k", "title $Title && $Command") -WindowStyle Normal | Out-Null
}
