$ErrorActionPreference = "Stop"

. "$PSScriptRoot\common.ps1"

$rootDir = Get-DittoRoot
$voiceBaseUrl = "https://huggingface.co/rhasspy/piper-voices/resolve/main/it/it_IT/paola/medium"
$voiceModelsDir = Join-Path $rootDir "backend\app\services\voice_models"
$modelOutputPath = Join-Path $voiceModelsDir $DittoPiperDefaultVoiceModelFilename
$configOutputPath = Join-Path $voiceModelsDir $DittoPiperDefaultVoiceConfigFilename
$tempDir = Join-Path $env:TEMP ("ditto-piper-" + [guid]::NewGuid().ToString("N"))

try {
    New-Item -ItemType Directory -Force -Path $voiceModelsDir | Out-Null
    if ((Test-Path $modelOutputPath) -and (Test-Path $configOutputPath)) {
        Write-Host "[OK] Modello Piper gia' presente: $DittoPiperDefaultVoiceKey"
        exit 0
    }

    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    Write-Host "[INFO] Download modello Piper $DittoPiperDefaultVoiceKey"

    Invoke-WebRequest -Uri "$voiceBaseUrl/$DittoPiperDefaultVoiceModelFilename" -OutFile (Join-Path $tempDir $DittoPiperDefaultVoiceModelFilename)
    Invoke-WebRequest -Uri "$voiceBaseUrl/$DittoPiperDefaultVoiceConfigFilename" -OutFile (Join-Path $tempDir $DittoPiperDefaultVoiceConfigFilename)

    Move-Item -LiteralPath (Join-Path $tempDir $DittoPiperDefaultVoiceModelFilename) -Destination $modelOutputPath -Force
    Move-Item -LiteralPath (Join-Path $tempDir $DittoPiperDefaultVoiceConfigFilename) -Destination $configOutputPath -Force

    Write-Host "[OK] Modello Piper pronto: $modelOutputPath"
} finally {
    if (Test-Path $tempDir) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
