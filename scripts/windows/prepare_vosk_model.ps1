$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Resolve-Path (Join-Path $scriptDir "..\..")
$modelName = "vosk-model-small-it-0.22"
$modelZipUrl = "https://alphacephei.com/vosk/models/$modelName.zip"
$modelsDir = Join-Path $rootDir "frontend\my-app\public\models"
$outputArchive = Join-Path $modelsDir "$modelName.tar.gz"
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "ditto-vosk-$([System.Guid]::NewGuid().ToString('N'))"

New-Item -ItemType Directory -Force -Path $modelsDir | Out-Null
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

try {
    $zipPath = Join-Path $tempDir "$modelName.zip"
    Write-Host "[INFO] Download $modelZipUrl"
    Invoke-WebRequest -Uri $modelZipUrl -OutFile $zipPath

    Write-Host "[INFO] Estrazione modello"
    Expand-Archive -Path $zipPath -DestinationPath $tempDir -Force

    $sourceModelDir = Join-Path $tempDir $modelName
    $tarRootDir = Join-Path $tempDir "tar-root"
    $targetModelDir = Join-Path $tarRootDir "model"
    New-Item -ItemType Directory -Force -Path $tarRootDir | Out-Null

    Move-Item -Path $sourceModelDir -Destination $targetModelDir

    if (Test-Path $outputArchive) {
        Remove-Item -LiteralPath $outputArchive -Force
    }

    Write-Host "[INFO] Creazione $outputArchive"
    tar -C $tarRootDir -czf $outputArchive model
    Write-Host "[OK] Modello Vosk pronto: $outputArchive"
} finally {
    if (Test-Path $tempDir) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force
    }
}
