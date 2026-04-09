param(
    [Parameter(Mandatory=$true)][string]$ScriptToRun,
    [string[]]$Arguments = @()
)

$argumentList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$ScriptToRun`"")
foreach ($arg in $Arguments) {
    $argumentList += "`"$arg`""
}

Write-Host "Avvio script elevato: $ScriptToRun"
Write-Host "Attendere il completamento..."

$process = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $argumentList -Wait -PassThru

exit $process.ExitCode