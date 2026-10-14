param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$Version
)
$ErrorActionPreference = 'Stop'
$installDirectory = Join-Path $env:RUNNER_TEMP "ccti-nsis-lifecycle-$Version"
$testHome = Join-Path $env:RUNNER_TEMP "ccti-nsis-home-$Version"
if (-not $env:GITHUB_ACTIONS -or -not $env:RUNNER_TEMP) { throw 'Run only on a disposable GitHub Actions Windows runner.' }
if (Test-Path -LiteralPath $installDirectory) { throw 'Refusing to overwrite an existing fixture install.' }
New-Item -ItemType Directory -Path $testHome | Out-Null
$launched = $null
try {
  $setup = Start-Process -FilePath $Installer -ArgumentList '/S', "/D=$installDirectory" -Wait -PassThru
  if ($setup.ExitCode -ne 0) { throw "NSIS install failed: $($setup.ExitCode)" }
  $app = Join-Path $installDirectory 'Claude Code Tools Installer.exe'
  $uninstaller = Join-Path $installDirectory 'Uninstall Claude Code Tools Installer.exe'
  if (-not (Test-Path -LiteralPath $app -PathType Leaf)) { throw 'Installed application executable missing.' }
  if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw 'Installed uninstaller missing.' }
  if (-not (Test-Path -LiteralPath (Join-Path $installDirectory 'resources/app.asar') -PathType Leaf)) { throw 'Installed application archive missing.' }
  $env:CCTI_ELECTRON_TEST = '1'
  $env:CCTI_TEST_HOME = $testHome
  $env:APPDATA = Join-Path $testHome 'AppData/Roaming'
  $env:LOCALAPPDATA = Join-Path $testHome 'AppData/Local'
  New-Item -ItemType Directory -Path $env:APPDATA, $env:LOCALAPPDATA -Force | Out-Null
  $launched = Start-Process -FilePath $app -PassThru
  Start-Sleep -Seconds 8
  $launched.Refresh()
  if ($launched.HasExited) { throw "Installed application exited during startup: $($launched.ExitCode)" }
  if ($launched.MainWindowHandle -eq 0) { throw 'Installed application did not create its main window.' }
  Stop-Process -Id $launched.Id -Force
  $launched.WaitForExit()
  $removed = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
  if ($removed.ExitCode -ne 0) { throw "NSIS uninstall failed: $($removed.ExitCode)" }
  for ($attempt = 0; $attempt -lt 10 -and (Test-Path -LiteralPath $app); $attempt++) { Start-Sleep -Seconds 1 }
  if (Test-Path -LiteralPath $app) { throw 'Application remains after the disposable uninstall.' }
  Write-Output 'PASS clean-runner unsigned NSIS install, main-window launch, and uninstall. No Claude Code setup or user-data deletion performed; automatic Windows updates are not claimed.'
} finally {
  if ($launched -and -not $launched.HasExited) { Stop-Process -Id $launched.Id -Force -ErrorAction SilentlyContinue }
}
