$ErrorActionPreference = "Stop"

. "$PSScriptRoot\common.ps1"

$rootDir = Get-HoloAssistantRoot
$voiceBaseUrl = "https://huggingface.co/rhasspy/piper-voices/resolve/main/it/it_IT/paola/medium"
$voiceModelsDir = Join-Path $rootDir "backend\app\services\voice_models"
$modelOutputPath = Join-Path $voiceModelsDir $HoloAssistantPiperDefaultVoiceModelFilename
$configOutputPath = Join-Path $voiceModelsDir $HoloAssistantPiperDefaultVoiceConfigFilename
$tempDir = Join-Path $env:TEMP ("holo-assistant-piper-" + [guid]::NewGuid().ToString("N"))

try {
    New-Item -ItemType Directory -Force -Path $voiceModelsDir | Out-Null
    if ((Test-Path $modelOutputPath) -and (Test-Path $configOutputPath)) {
        Write-Host "[OK] Modello Piper gia' presente: $HoloAssistantPiperDefaultVoiceKey"
        exit 0
    }

    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    Write-Host "[INFO] Download modello Piper $HoloAssistantPiperDefaultVoiceKey"

    Invoke-WebRequest -Uri "$voiceBaseUrl/$HoloAssistantPiperDefaultVoiceModelFilename" -OutFile (Join-Path $tempDir $HoloAssistantPiperDefaultVoiceModelFilename)
    Invoke-WebRequest -Uri "$voiceBaseUrl/$HoloAssistantPiperDefaultVoiceConfigFilename" -OutFile (Join-Path $tempDir $HoloAssistantPiperDefaultVoiceConfigFilename)

    Move-Item -LiteralPath (Join-Path $tempDir $HoloAssistantPiperDefaultVoiceModelFilename) -Destination $modelOutputPath -Force
    Move-Item -LiteralPath (Join-Path $tempDir $HoloAssistantPiperDefaultVoiceConfigFilename) -Destination $configOutputPath -Force

    Write-Host "[OK] Modello Piper pronto: $modelOutputPath"
} finally {
    if (Test-Path $tempDir) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
