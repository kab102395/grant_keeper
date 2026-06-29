$repoRoot  = Split-Path -Parent $PSScriptRoot
$tauriRoot = Join-Path $repoRoot "src-tauri"
$vitePort  = 5173
$viteHost  = "127.0.0.1"
$viteScript = Join-Path $PSScriptRoot "start-vite.ps1"

Set-Location $repoRoot

# Kill stale grant-keeper, cargo, and any node holding the Vite port
Get-Process grant-keeper -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process cargo        -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$vitePids = Get-NetTCPConnection -LocalPort $vitePort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
if ($vitePids) {
    Stop-Process -Id $vitePids -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 500

# Start Vite in a hidden background window
Start-Process powershell.exe `
    -WindowStyle Hidden `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $viteScript

# Wait for Vite to accept connections (up to 45 s)
$deadline = (Get-Date).AddSeconds(45)
$ready = $false
while ((Get-Date) -lt $deadline) {
    try {
        $tcp = [System.Net.Sockets.TcpClient]::new()
        $tcp.Connect($viteHost, $vitePort)
        $tcp.Close()
        $ready = $true
        break
    } catch {
        Start-Sleep -Milliseconds 300
    }
}
if (-not $ready) {
    Write-Error "Vite did not start on port $vitePort within 45 seconds."
    exit 1
}

Write-Host "Vite ready. Starting Grant Keeper..." -ForegroundColor Green

# Build and run the Rust backend in a visible window that stays open on error
Start-Process powershell.exe `
    -WindowStyle Normal `
    -WorkingDirectory $tauriRoot `
    -ArgumentList "-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `
        "cargo run --no-default-features; if (`$LASTEXITCODE -ne 0) { Write-Host 'cargo exited with code' `$LASTEXITCODE -ForegroundColor Red; pause }"
