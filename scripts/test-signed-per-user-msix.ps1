[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$UnsignedBundle,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$IdentityName,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Publisher,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$ProcessName,

  [ValidateRange(5, 60)]
  [int]$LaunchTimeoutSeconds = 15
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Find-WindowsSdkTool {
  param([Parameter(Mandatory = $true)][string]$Name)

  $kitRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  $tool = Get-ChildItem -Path $kitRoot -Filter $Name -File -Recurse |
    Sort-Object FullName -Descending |
    Select-Object -First 1
  if (-not $tool) {
    throw "$Name was not found. Install the Windows SDK before running the interactive per-user lifecycle test."
  }
  return $tool.FullName
}

function Remove-TestCertificate {
  param([AllowNull()]$Certificate)

  if (-not $Certificate) { return }
  foreach ($store in 'Cert:\CurrentUser\My', 'Cert:\CurrentUser\TrustedPeople') {
    $candidate = Join-Path $store $Certificate.Thumbprint
    if (Test-Path $candidate) {
      Remove-Item -Path $candidate -Force -ErrorAction SilentlyContinue
    }
  }
}

$sourceBundle = Resolve-Path -LiteralPath $UnsignedBundle -ErrorAction Stop
if ($env:USERNAME -eq 'SYSTEM' -or $env:SESSIONNAME -match '^(Services|Service)$') {
  throw 'Run this lifecycle test from a standard user interactive Windows session. Do not use a service, elevated session, or CI runner.'
}

$signTool = Find-WindowsSdkTool -Name 'signtool.exe'
$testRoot = Join-Path $env:TEMP ("ccti-msix-per-user-{0}" -f [guid]::NewGuid().ToString('N'))
$testBundle = Join-Path $testRoot (Split-Path -Leaf $sourceBundle.Path)
$certificate = $null
$registered = $null

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
Copy-Item -LiteralPath $sourceBundle.Path -Destination $testBundle -Force

try {
  $certificate = New-SelfSignedCertificate `
    -Subject $Publisher `
    -Type CodeSigningCert `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddDays(1)
  if ($certificate.Subject -ne $Publisher) {
    throw 'The temporary certificate subject does not exactly match the bundle publisher.'
  }

  & $signTool sign /fd SHA256 /sha1 $certificate.Thumbprint $testBundle
  if ($LASTEXITCODE -ne 0) { throw 'SignTool could not sign the temporary bundle copy.' }

  $certificateFile = Join-Path $testRoot 'per-user-test.cer'
  Export-Certificate -Cert $certificate -FilePath $certificateFile | Out-Null
  Import-Certificate -FilePath $certificateFile -CertStoreLocation 'Cert:\CurrentUser\TrustedPeople' | Out-Null

  & $signTool verify /pa /v $testBundle
  if ($LASTEXITCODE -ne 0) { throw 'SignTool could not verify the temporary bundle copy.' }

  Add-AppxPackage -Path $testBundle
  $registered = Get-AppxPackage -Name $IdentityName
  if (-not $registered) { throw 'The temporary MSIX bundle was not registered for the current user.' }

  [xml]$manifest = Get-AppxPackageManifest -Package $registered.PackageFullName
  $applicationId = $manifest.Package.Applications.Application.Id
  if ([string]::IsNullOrWhiteSpace($applicationId)) { throw 'The installed package does not declare an application ID.' }
  $aumid = "$($registered.PackageFamilyName)!$applicationId"

  Start-Process "shell:AppsFolder\$aumid"
  $deadline = (Get-Date).AddSeconds($LaunchTimeoutSeconds)
  $running = $null
  while ((Get-Date) -lt $deadline) {
    $running = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($running) { break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $running) {
    throw 'AUMID launch did not start the expected process. Do not launch the executable directly or change protected installation permissions.'
  }

  Stop-Process -Id $running.Id -Force -ErrorAction SilentlyContinue
  Remove-AppxPackage -Package $registered.PackageFullName
  if (Get-AppxPackage -Name $IdentityName) { throw 'The test package remains registered after removal.' }
  $registered = $null

  Write-Host 'PASS: current-user MSIX sign, install, AUMID launch, and uninstall lifecycle completed.'
} finally {
  if ($registered) {
    Remove-AppxPackage -Package $registered.PackageFullName -ErrorAction SilentlyContinue
  }
  Remove-TestCertificate -Certificate $certificate
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
