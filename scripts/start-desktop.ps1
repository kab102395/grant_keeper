$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$tauriRoot = Join-Path $repoRoot "src-tauri"
$vitePort = 5173
$viteHost = "127.0.0.1"
$viteUrl = "http://$viteHost`:$vitePort"
$viteScript = Join-Path $PSScriptRoot "start-vite.ps1"
$grantKeeperExe = Join-Path $tauriRoot "target\debug\grant-keeper.exe"

Set-Location $repoRoot

$staleGrantKeeper = Get-Process grant-keeper -ErrorAction SilentlyContinue
if ($staleGrantKeeper) {
    $staleGrantKeeper | Stop-Process -Force
}

$unlockDeadline = (Get-Date).AddSeconds(20)
while (Test-Path $grantKeeperExe) {
    try {
        Remove-Item -LiteralPath $grantKeeperExe -Force -ErrorAction Stop
        break
    } catch {
        if ((Get-Date) -gt $unlockDeadline) {
            throw "Grant Keeper is still holding $grantKeeperExe. Close any running app window and try again."
        }
        Start-Sleep -Milliseconds 500
    }
}

$listener = Get-NetTCPConnection -LocalPort $vitePort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    try {
        Stop-Process -Id $listener.OwningProcess -Force
    } catch {
        # The port may already be in the middle of shutting down.
    }
}

Start-Process -FilePath "powershell.exe" `
    -WindowStyle Hidden `
    -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        $viteScript
    ) | Out-Null

$deadline = (Get-Date).AddSeconds(45)
while (-not (Test-NetConnection -ComputerName $viteHost -Port $vitePort -InformationLevel Quiet)) {
    if ((Get-Date) -gt $deadline) {
        throw "Vite did not become ready at $viteUrl within 45 seconds."
    }
    Start-Sleep -Milliseconds 250
}

Start-Process -FilePath "powershell.exe" `
    -WindowStyle Normal `
    -WorkingDirectory $tauriRoot `
    -ArgumentList @(
        "-NoExit",
        "-Command",
        "cargo run --no-default-features"
    ) | Out-Null
