# Builds the MSIX package for the Microsoft Store from a finished Windows
# build (target/release: ondura.exe, ondura_core.dll and the per-app
# programs, see scripts/windows-binaries.ps1).
#
#   pwsh scripts/windows-msix.ps1 [-Out target/release/bundle/msix]
#
# The package identity comes from Partner Center (Apps and games › Ondura ›
# Product identity) through these environment variables; without them the
# package gets placeholder values and can only be tried out locally:
#
#   MSIX_IDENTITY_NAME            Package/Identity/Name, e.g. 12345MirraNET.Ondura
#   MSIX_PUBLISHER                Package/Identity/Publisher, e.g. CN=1A2B3C4D-…
#   MSIX_PUBLISHER_DISPLAY_NAME   Package/Properties/PublisherDisplayName
#   MSIX_DISPLAY_NAME             reserved app name (default: Ondura)
#
# The package is not signed: the Store signs it after certification. The
# unpacked layout (target/msix/layout) can be registered for a local test
# with `Add-AppxPackage -Register target\msix\layout\AppxManifest.xml`
# (Settings › System › For developers › Developer Mode).

param(
  [string]$Out = "target/release/bundle/msix"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  $tauri = "apps/ondura/src-tauri"
  $version = (Get-Content "$tauri/tauri.conf.json" -Raw | ConvertFrom-Json).version
  if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "version $version is not MAJOR.MINOR.PATCH" }
  # The Store requires the fourth part to be 0.
  $msixVersion = "$version.0"

  $identity = if ($env:MSIX_IDENTITY_NAME) { $env:MSIX_IDENTITY_NAME } else { "MirraNET.Ondura" }
  $publisher = if ($env:MSIX_PUBLISHER) { $env:MSIX_PUBLISHER } else { "CN=MirraNET" }
  $publisherName = if ($env:MSIX_PUBLISHER_DISPLAY_NAME) { $env:MSIX_PUBLISHER_DISPLAY_NAME } else { "MirraNET" }
  $displayName = if ($env:MSIX_DISPLAY_NAME) { $env:MSIX_DISPLAY_NAME } else { "Ondura" }
  if (-not $env:MSIX_IDENTITY_NAME -or -not $env:MSIX_PUBLISHER) {
    Write-Warning "MSIX_IDENTITY_NAME/MSIX_PUBLISHER not set: the package has placeholder identity values and cannot be submitted to the Store."
  }

  # --- layout -------------------------------------------------------------
  $layout = "target/msix/layout"
  if (Test-Path $layout) { Remove-Item -Recurse -Force $layout }
  New-Item -ItemType Directory -Force "$layout/icons" | Out-Null

  $apps = "mail", "text", "sheets", "slides", "pdf", "notes", "planner", "diagram", "forms"
  $binaries = @("ondura.exe", "ondura_core.dll") + ($apps | ForEach-Object { "ondura-$_.exe" })
  foreach ($b in $binaries) {
    if (-not (Test-Path "target/release/$b")) { throw "target/release/$b is missing (build Ondura first)" }
    Copy-Item "target/release/$b" "$layout/$b"
  }
  foreach ($a in $apps) { Copy-Item "$tauri/icons/apps/$a.ico" "$layout/icons/$a.ico" }
  Copy-Item "THIRD-PARTY-NOTICES.txt" "$layout/THIRD-PARTY-NOTICES.txt"
  Copy-Item "LICENSE" "$layout/LICENSE.txt"
  Copy-Item -Recurse "$tauri/msix/Strings" "$layout/Strings"

  $esc = { param($s) [System.Security.SecurityElement]::Escape($s) }
  $manifest = Get-Content "$tauri/msix/AppxManifest.xml" -Raw -Encoding utf8
  $manifest = $manifest.Replace("{{IDENTITY_NAME}}", (& $esc $identity))
  $manifest = $manifest.Replace("{{PUBLISHER_DISPLAY_NAME}}", (& $esc $publisherName))
  $manifest = $manifest.Replace("{{PUBLISHER}}", (& $esc $publisher))
  $manifest = $manifest.Replace("{{DISPLAY_NAME}}", (& $esc $displayName))
  $manifest = $manifest.Replace("{{VERSION}}", $msixVersion)
  if ($manifest -match '\{\{[A-Z_]+\}\}') { throw "unfilled placeholder in AppxManifest.xml: $($Matches[0])" }
  [System.IO.File]::WriteAllText((Join-Path $root "$layout/AppxManifest.xml"), $manifest, (New-Object System.Text.UTF8Encoding $false))

  # Logos in all sizes (Pillow renders them from the app icons).
  $python = if (Get-Command python -ErrorAction SilentlyContinue) { "python" } else { "python3" }
  & $python -c "import PIL" 2>$null
  if ($LASTEXITCODE -ne 0) {
    & $python -m pip install --quiet pillow
    if ($LASTEXITCODE -ne 0) { throw "installing Pillow failed" }
  }
  & $python scripts/msix-assets.py $layout
  # (also checks that every logo the manifest names is there)
  if ($LASTEXITCODE -ne 0) { throw "rendering or checking the logos failed" }

  # --- Windows SDK tools ------------------------------------------------------
  $kits = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
  $sdk = Get-ChildItem $kits -Directory -Filter "10.*" -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName "x64\makeappx.exe") } |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
  if (-not $sdk) { throw "Windows SDK (makeappx.exe, makepri.exe) not found under $kits" }
  $makeappx = Join-Path $sdk.FullName "x64\makeappx.exe"
  $makepri = Join-Path $sdk.FullName "x64\makepri.exe"

  # resources.pri: the texts (Strings/<language>) and the logo variants.
  $priconfig = "target/msix/priconfig.xml"
  & $makepri createconfig /cf $priconfig /dq de-DE_en-US_fr-FR /pv 10.0.0 /o | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "makepri createconfig failed ($LASTEXITCODE)" }
  & $makepri new /pr $layout /cf $priconfig /mn "$layout/AppxManifest.xml" /of "$layout/resources.pri" /o | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "makepri new failed ($LASTEXITCODE)" }

  # Windows finds the scaled logos only through resources.pri: make sure
  # every logo of the manifest is indexed with its variants, otherwise Start
  # and the taskbar show placeholder icons.
  $dump = "target/msix/resources.dump.xml"
  & $makepri dump /if "$layout/resources.pri" /of $dump /dt Detailed /o | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "makepri dump failed ($LASTEXITCODE)" }
  # XmlDocument.Load detects the encoding of the dump (UTF-8 or UTF-16).
  $pri = New-Object System.Xml.XmlDocument
  $pri.Load((Resolve-Path $dump).Path)
  $resources = @($pri.SelectNodes("//*[local-name()='NamedResource']"))
  $withCandidates = @($pri.SelectNodes("//*[local-name()='Candidate']")).Count -gt 0
  if (-not $withCandidates) { Write-Warning "the makepri dump lists no candidates; only checking that each logo is indexed" }
  $logos = [regex]::Matches($manifest, 'Assets\\[^"<]+?\.png') | ForEach-Object { $_.Value } | Sort-Object -Unique
  foreach ($logo in $logos) {
    $uri = "/Files/" + $logo.Replace('\', '/')
    $node = $resources | Where-Object { $_.GetAttribute("uri").EndsWith($uri, [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
    if (-not $node) { throw "$logo is not in resources.pri" }
    if ($withCandidates) {
      # The logo needs its scaled variants, not just the unqualified fallback.
      $candidates = @($node.SelectNodes(".//*[local-name()='Candidate']"))
      if ($candidates.Count -lt 2) {
        Write-Host $node.OuterXml
        throw "$logo has only $($candidates.Count) variant(s) in resources.pri"
      }
    }
  }
  Write-Host "resources.pri: $($logos.Count) logos with their variants"

  # --- package --------------------------------------------------------------
  New-Item -ItemType Directory -Force $Out | Out-Null
  $package = Join-Path $Out "Ondura_${version}_x64.msix"
  & $makeappx pack /d $layout /p $package /o | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "makeappx pack failed ($LASTEXITCODE)" }
  Write-Host "MSIX package: $package ($identity, $msixVersion)"
} finally {
  Pop-Location
}
