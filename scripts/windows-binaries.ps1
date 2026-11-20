# Builds the per-app programs (ondura-mail.exe, ondura-text.exe, …) and
# ondura_core.dll, the suite they share, next to ondura.exe in
# target/release, and signs them like ondura.exe when signing is configured
# (scripts/windows-sign.ps1 does nothing without signing secrets).
#
# Tauri runs this as `beforeBundleCommand` (src-tauri/tauri.windows.conf.json),
# after building ondura.exe and before the NSIS installer is made, which
# picks the files up (src-tauri/windows/installer.nsi, ONDURA_BINARY).

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  cargo build --release -p ondura-core-dll -p ondura-launcher --features ondura-core-dll/custom-protocol
  if ($LASTEXITCODE -ne 0) { throw "cargo build failed ($LASTEXITCODE)" }

  $apps = "mail", "text", "sheets", "slides", "pdf", "notes", "planner", "diagram", "forms"
  $files = @("target/release/ondura_core.dll") + ($apps | ForEach-Object { "target/release/ondura-$_.exe" })
  foreach ($f in $files) {
    if (-not (Test-Path $f)) { throw "$f is missing" }
  }

  $shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { "pwsh" } else { "powershell" }
  $sign = Join-Path $PSScriptRoot "windows-sign.ps1"
  foreach ($f in $files) {
    & $shell -NoProfile -ExecutionPolicy Bypass -File $sign (Resolve-Path $f).Path
    if ($LASTEXITCODE -ne 0) { throw "signing $f failed ($LASTEXITCODE)" }
  }
} finally {
  Pop-Location
}
