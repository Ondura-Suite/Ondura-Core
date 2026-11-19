# Authenticode-signs one Windows binary (ondura.exe, the NSIS installer and
# uninstaller, Ondura Setup). Tauri calls it as its `signCommand` during the
# build; CI calls it once more for Ondura Setup.
#
# Unsigned builds are flagged by SmartScreen and often by Defender's machine
# learning ("Trojan:Win32/...!ml"), especially an installer that unpacks and
# runs another installer. Configure one of these in GitHub (secrets):
#
#   Azure Artifact Signing (formerly Trusted Signing):
#     AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET   (app registration
#       with the "Artifact Signing Certificate Profile Signer" role)
#     ARTIFACT_SIGNING_ENDPOINT   e.g. https://weu.codesigning.azure.net
#     ARTIFACT_SIGNING_ACCOUNT    account name
#     ARTIFACT_SIGNING_PROFILE    certificate profile name
#     ARTIFACT_SIGNING_DLIB       path to Azure.CodeSigning.Dlib.dll (CI sets it)
#
#   or a code signing certificate as .pfx:
#     WINDOWS_CERTIFICATE           base64 of the .pfx file
#     WINDOWS_CERTIFICATE_PASSWORD  its password
#
# Without either, the script does nothing, so local and fork builds work.

param([Parameter(Mandatory = $true)][string]$File)
$ErrorActionPreference = "Stop"

function Find-SignTool {
  $kits = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
  $tool = Get-ChildItem -Path $kits -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\x64\\" } |
    Sort-Object { [version]($_.FullName -replace '.*\\bin\\([0-9.]+)\\.*', '$1') } -Descending |
    Select-Object -First 1
  if (-not $tool) { throw "signtool.exe not found (Windows SDK)" }
  return $tool.FullName
}

$timestamp = "http://timestamp.acs.microsoft.com"

if ($env:ARTIFACT_SIGNING_ACCOUNT -and $env:AZURE_CLIENT_SECRET) {
  $signtool = Find-SignTool
  $metadata = Join-Path $env:RUNNER_TEMP "artifact-signing.json"
  @{
    Endpoint = $env:ARTIFACT_SIGNING_ENDPOINT
    CodeSigningAccountName = $env:ARTIFACT_SIGNING_ACCOUNT
    CertificateProfileName = $env:ARTIFACT_SIGNING_PROFILE
  } | ConvertTo-Json | Set-Content -Path $metadata -Encoding utf8
  & $signtool sign /v /fd SHA256 /tr $timestamp /td SHA256 /dlib $env:ARTIFACT_SIGNING_DLIB /dmdf $metadata $File
  if ($LASTEXITCODE -ne 0) { throw "signtool failed for $File" }
  Write-Host "Signed (Artifact Signing): $File"
}
elseif ($env:WINDOWS_CERTIFICATE) {
  $signtool = Find-SignTool
  $pfx = Join-Path $env:RUNNER_TEMP "ondura-signing.pfx"
  if (-not (Test-Path $pfx)) { [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:WINDOWS_CERTIFICATE)) }
  & $signtool sign /v /fd SHA256 /tr "http://timestamp.digicert.com" /td SHA256 /f $pfx /p $env:WINDOWS_CERTIFICATE_PASSWORD $File
  if ($LASTEXITCODE -ne 0) { throw "signtool failed for $File" }
  Write-Host "Signed (certificate): $File"
}
else {
  Write-Host "No Windows signing configured: $File stays unsigned."
}
