# Builds the MSIX packages for the Microsoft Store from a finished Windows
# build (target/release: ondura.exe, ondura_core.dll and the per-app
# programs, see scripts/windows-binaries.ps1):
#
#   suite  Ondura_<version>_x64.msix       every app (Store product "Ondura")
#   mail   OnduraMail_<version>_x64.msix   Ondura Mail on its own
#   pdf    OnduraPDF_<version>_x64.msix    Ondura PDF on its own
#
#   pwsh scripts/windows-msix.ps1 [-Package all|suite|mail|pdf] [-Out target/release/bundle/msix]
#
# Each package is its own Store product with its own identity from Partner
# Center (Apps and games › <product> › Product identity), set through these
# environment variables; without them a package gets placeholder values and
# can only be tried out locally:
#
#   MSIX_PUBLISHER                Package/Identity/Publisher, e.g. CN=1A2B3C4D-… (all packages)
#   MSIX_PUBLISHER_DISPLAY_NAME   Package/Properties/PublisherDisplayName (all packages)
#   MSIX_IDENTITY_NAME            Package/Identity/Name of Ondura, e.g. 12345MirraNET.Ondura
#   MSIX_DISPLAY_NAME             reserved name of Ondura (default: Ondura)
#   MSIX_MAIL_IDENTITY_NAME       … of Ondura Mail
#   MSIX_MAIL_DISPLAY_NAME        (default: Ondura Mail)
#   MSIX_PDF_IDENTITY_NAME        … of Ondura PDF
#   MSIX_PDF_DISPLAY_NAME         (default: Ondura PDF)
#
# The standalone packages take their Start entry from the suite manifest
# (msix/AppxManifest.xml) and a components.ini with `apps=<id>`, so the app
# knows that the other apps are not installed (src-tauri/src/windows.rs).
#
# The packages are not signed: the Store signs them after certification.
# The unpacked layout (target/msix/<package>/layout) can be registered for a
# local test with `Add-AppxPackage -Register target\msix\suite\layout\AppxManifest.xml`
# (Settings › System › For developers › Developer Mode).

param(
  [ValidateSet("all", "suite", "mail", "pdf")]
  [string]$Package = "all",
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

  $publisher = if ($env:MSIX_PUBLISHER) { $env:MSIX_PUBLISHER } else { "CN=MirraNET" }
  $publisherName = if ($env:MSIX_PUBLISHER_DISPLAY_NAME) { $env:MSIX_PUBLISHER_DISPLAY_NAME } else { "MirraNET" }

  # --- Windows SDK tools ------------------------------------------------------
  $kits = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
  $sdk = Get-ChildItem $kits -Directory -Filter "10.*" -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName "x64\makeappx.exe") } |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
  if (-not $sdk) { throw "Windows SDK (makeappx.exe, makepri.exe) not found under $kits" }
  $makeappx = Join-Path $sdk.FullName "x64\makeappx.exe"
  $makepri = Join-Path $sdk.FullName "x64\makepri.exe"

  # Id, Store name, file name, environment prefix, apps, Start entry
  # (standalone only) and the app whose icon is the Store logo.
  $packages = @(
    @{ Id = "suite"; Name = "Ondura"; File = "Ondura"; Env = ""; Apps = @("mail", "text", "sheets", "slides", "pdf", "notes", "planner", "diagram", "forms"); Entry = $null; Logo = "ondura" },
    @{ Id = "mail"; Name = "Ondura Mail"; File = "OnduraMail"; Env = "MAIL"; Apps = @("mail"); Entry = "Mail"; Logo = "mail" },
    @{ Id = "pdf"; Name = "Ondura PDF"; File = "OnduraPDF"; Env = "PDF"; Apps = @("pdf"); Entry = "Pdf"; Logo = "pdf" }
  ) | Where-Object { $Package -eq "all" -or $_.Id -eq $Package }

  foreach ($p in $packages) {
    $prefix = if ($p.Env) { "MSIX_$($p.Env)_" } else { "MSIX_" }
    $identityVar = [Environment]::GetEnvironmentVariable("${prefix}IDENTITY_NAME")
    $displayVar = [Environment]::GetEnvironmentVariable("${prefix}DISPLAY_NAME")
    $identity = if ($identityVar) { $identityVar } else { "MirraNET.$($p.Name.Replace(' ', ''))" }
    $displayName = if ($displayVar) { $displayVar } else { $p.Name }
    if (-not $identityVar -or -not $env:MSIX_PUBLISHER) {
      Write-Warning "${prefix}IDENTITY_NAME/MSIX_PUBLISHER not set: $($p.File) has placeholder identity values and cannot be submitted to the Store."
    }

    # --- layout -------------------------------------------------------------
    $work = "target/msix/$($p.Id)"
    $layout = "$work/layout"
    if (Test-Path $layout) { Remove-Item -Recurse -Force $layout }
    New-Item -ItemType Directory -Force "$layout/icons" | Out-Null

    $apps = $p.Apps
    $binaries = @("ondura.exe", "ondura_core.dll") + ($apps | ForEach-Object { "ondura-$_.exe" })
    foreach ($b in $binaries) {
      if (-not (Test-Path "target/release/$b")) { throw "target/release/$b is missing (build Ondura first)" }
      Copy-Item "target/release/$b" "$layout/$b"
    }
    foreach ($a in $apps) { Copy-Item "$tauri/icons/apps/$a.ico" "$layout/icons/$a.ico" }
    Copy-Item "THIRD-PARTY-NOTICES.txt" "$layout/THIRD-PARTY-NOTICES.txt"
    Copy-Item "LICENSE" "$layout/LICENSE.txt"
    Copy-Item -Recurse "$tauri/msix/Strings" "$layout/Strings"
    if ($p.Id -ne "suite") {
      # Tells the app that it is the only one installed.
      [System.IO.File]::WriteAllText((Join-Path $root "$layout/components.ini"), "[Apps]`r`napps=$($apps -join ',')`r`n", (New-Object System.Text.UTF8Encoding $false))
    }

    $esc = { param($s) [System.Security.SecurityElement]::Escape($s) }
    $manifest = Get-Content "$tauri/msix/AppxManifest.xml" -Raw -Encoding utf8
    $manifest = $manifest.Replace("{{IDENTITY_NAME}}", (& $esc $identity))
    $manifest = $manifest.Replace("{{PUBLISHER_DISPLAY_NAME}}", (& $esc $publisherName))
    $manifest = $manifest.Replace("{{PUBLISHER}}", (& $esc $publisher))
    $manifest = $manifest.Replace("{{DISPLAY_NAME}}", (& $esc $displayName))
    $manifest = $manifest.Replace("{{VERSION}}", $msixVersion)
    if ($manifest -match '\{\{[A-Z_]+\}\}') { throw "unfilled placeholder in AppxManifest.xml: $($Matches[0])" }
    if ($p.Entry) {
      # Standalone: only the Start entry of its app, described by that app.
      $xml = New-Object System.Xml.XmlDocument
      $xml.PreserveWhitespace = $true
      $xml.LoadXml($manifest)
      $entries = @($xml.SelectNodes("//*[local-name()='Application']"))
      foreach ($e in $entries) {
        if ($e.GetAttribute("Id") -ne $p.Entry) { [void]$e.ParentNode.RemoveChild($e) }
      }
      if (@($xml.SelectNodes("//*[local-name()='Application']")).Count -ne 1) { throw "Application $($p.Entry) not found in AppxManifest.xml" }
      $xml.SelectSingleNode("//*[local-name()='Properties']/*[local-name()='Description']").InnerText = "ms-resource:$($p.Entry)Description"
      $manifest = $xml.OuterXml
    }
    [System.IO.File]::WriteAllText((Join-Path $root "$layout/AppxManifest.xml"), $manifest, (New-Object System.Text.UTF8Encoding $false))

    # Logos in all sizes (Pillow renders them from the app icons).
    $python = if (Get-Command python -ErrorAction SilentlyContinue) { "python" } else { "python3" }
    & $python -c "import PIL" 2>$null
    if ($LASTEXITCODE -ne 0) {
      & $python -m pip install --quiet pillow
      if ($LASTEXITCODE -ne 0) { throw "installing Pillow failed" }
    }
    & $python scripts/msix-assets.py $layout $p.Logo
    # (also checks that every logo the manifest names is there)
    if ($LASTEXITCODE -ne 0) { throw "rendering or checking the logos failed" }

    # resources.pri: the texts (Strings/<language>) and the logo variants.
    $priconfig = "$work/priconfig.xml"
    & $makepri createconfig /cf $priconfig /dq de-DE_en-US_fr-FR /pv 10.0.0 /o | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "makepri createconfig failed ($LASTEXITCODE)" }
    & $makepri new /pr $layout /cf $priconfig /mn "$layout/AppxManifest.xml" /of "$layout/resources.pri" /o | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "makepri new failed ($LASTEXITCODE)" }

    # Windows finds the scaled logos only through resources.pri: make sure
    # every logo of the manifest is indexed with its variants, otherwise Start
    # and the taskbar show placeholder icons.
    $dump = "$work/resources.dump.xml"
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
    Write-Host "$($p.File): resources.pri has $($logos.Count) logos with their variants"

    # --- package --------------------------------------------------------------
    New-Item -ItemType Directory -Force $Out | Out-Null
    $msix = Join-Path $Out "$($p.File)_${version}_x64.msix"
    & $makeappx pack /d $layout /p $msix /o | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "makeappx pack failed ($LASTEXITCODE)" }
    Write-Host "MSIX package: $msix ($identity, $msixVersion)"
  }
} finally {
  Pop-Location
}
