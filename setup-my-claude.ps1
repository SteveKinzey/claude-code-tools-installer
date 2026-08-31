param(
  [switch]$DryRun,
  [switch]$Defaults,
  [switch]$All,
  [switch]$BootstrapOnly,
  [switch]$ClaudeOnly,
  [switch]$Complete,
  [switch]$Fresh,
  [switch]$FreshConfirmed,
  [switch]$NoLaunch,
  [switch]$Yes,
  [switch]$Uninstall,
  [Alias("Items")]
  [string]$Item = "",
  [Alias("Categories")]
  [string]$Category = "",
  [switch]$Help
)

$ErrorActionPreference = "Stop"
$ScriptVersion = "2026-08-26"
$BaseDir = Join-Path $HOME ".setup-my-claude"
$CloneDir = Join-Path $HOME ".claude\reference-repos"
$NodeRuntimeDir = Join-Path $BaseDir "node-runtime"
$LogDir = Join-Path $BaseDir "logs"
$Manifest = Join-Path $BaseDir "manifest.tsv"
$PluginCommands = Join-Path $BaseDir "claude-plugin-commands.md"
$ClaudeBootstrapState = Join-Path $BaseDir "claude-code-bootstrap.pid"
$ClaudeBootstrapProcess = $null
$ClaudeBootstrapStdOut = $null
$ClaudeBootstrapStdErr = $null
$ClaudeLaunched = $false

function Show-Usage {
  @"
setup-my-claude.ps1

Safe interactive Windows PowerShell installer for a curated Claude Code extension stack.

Claude Code is started in a minimized background PowerShell window when it is already installed.
If it is missing, the official Claude Code installer starts in the background while you make selections.

Usage:
  pwsh -File .\setup-my-claude.ps1                         Interactive selection
  pwsh -File .\setup-my-claude.ps1 -Defaults               Install curated defaults
  pwsh -File .\setup-my-claude.ps1 -DryRun                 Show what would happen
  pwsh -File .\setup-my-claude.ps1 -Item id,id             Install specific item ids
  pwsh -File .\setup-my-claude.ps1 -Category cat           Install a category: harness,skills,memory,tools,cost
  pwsh -File .\setup-my-claude.ps1 -All                    Select every installable item
  pwsh -File .\setup-my-claude.ps1 -BootstrapOnly          Start or open Claude Code, then exit
  pwsh -File .\setup-my-claude.ps1 -ClaudeOnly             Install Claude Code only and wait until it is ready
  pwsh -File .\setup-my-claude.ps1 -Complete               Install prerequisites, Claude Code, and curated defaults
  pwsh -File .\setup-my-claude.ps1 -Fresh                  Remove Claude Code and its local data before setup (requires -Complete)
  pwsh -File .\setup-my-claude.ps1 -NoLaunch               Do not open a PowerShell window after preparation
  pwsh -File .\setup-my-claude.ps1 -Uninstall              Roll back items recorded in the manifest

Options can be combined, for example:
  pwsh -File .\setup-my-claude.ps1 -Defaults -DryRun
"@
}

if ($Help) {
  Show-Usage
  exit 0
}
if ($Fresh -and -not $Complete) {
  throw "-Fresh must be used with -Complete."
}
if ($Fresh -and -not $FreshConfirmed) {
  throw "-Fresh is destructive and requires confirmation from the desktop app."
}
if ($Complete) {
  $Defaults = $true
  $Yes = $true
  $NoLaunch = $false
}

$LogFile = $null
if (-not $DryRun) {
  New-Item -ItemType Directory -Force -Path $BaseDir, $CloneDir, $LogDir | Out-Null
  $LogFile = Join-Path $LogDir ("run-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
  New-Item -ItemType File -Force -Path $Manifest, $LogFile, $PluginCommands | Out-Null
}

function Write-Log {
  param([string]$Message)
  $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"), $Message
  Write-Host $line
  if (-not $DryRun) { Add-Content -Path $LogFile -Value $line }
}

function Invoke-Logged {
  param(
    [string]$Command,
    [string[]]$Arguments = @()
  )
  Write-Log ("+ {0} {1}" -f $Command, ($Arguments -join " "))
  if ($DryRun) {
    return
  }
  & $Command @Arguments
}

function Add-Manifest {
  param(
    [string]$Kind,
    [string]$Target,
    [string]$Extra,
    [string]$ItemId
  )
  if ($DryRun) { return }
  $line = "{0}`t{1}`t{2}`t{3}`t{4}" -f (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"), $Kind, $Target, $Extra, $ItemId
  Add-Content -Path $Manifest -Value $line
}

function Add-PluginCommand {
  param(
    [string]$Title,
    [string]$Commands,
    [string]$Source
  )
  if ($DryRun) {
    Write-Log "Dry run: would queue Claude Code plugin commands for $Title"
    return
  }
  Add-Content -Path $PluginCommands -Value @"

## $Title

Source: $Source

Run inside Claude Code:

````text
$Commands
````
"@
}

function Require-Command {
  param([string]$Command)
  if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
    throw "Missing dependency: $Command"
  }
}

function Refresh-ClaudePath {
  $pathParts = @($env:Path)
  foreach ($scope in @("User", "Machine")) {
    $scopePath = [Environment]::GetEnvironmentVariable("Path", $scope)
    if ($scopePath) {
      $pathParts += $scopePath
    }
  }
  $nativeBin = Join-Path $HOME ".local\bin"
  if (Test-Path $nativeBin) {
    $pathParts += $nativeBin
  }
  if (Test-Path $NodeRuntimeDir) {
    $pathParts += $NodeRuntimeDir
  }
  $env:Path = (($pathParts -join ";") -split ";" | Where-Object { $_ } | Select-Object -Unique) -join ";"
}

function Ensure-NodeRuntime {
  Refresh-ClaudePath
  if ((Get-Command node -ErrorAction SilentlyContinue) -and (Get-Command npm -ErrorAction SilentlyContinue) -and (Get-Command npx -ErrorAction SilentlyContinue)) {
    Write-Log "Node.js toolchain detected: $((& node --version 2>$null) -join ' ')"
    return
  }
  if ($DryRun) {
    Write-Log "Dry run: would download the official Node.js 22 LTS runtime into $NodeRuntimeDir"
    return
  }
  $architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
  if ($architecture -notin @("x64", "arm64")) { throw "Unsupported Windows processor architecture for managed Node.js: $architecture" }
  $downloadDir = Join-Path $BaseDir ("node-download-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
  try {
    $checksumPath = Join-Path $downloadDir "SHASUMS256.txt"
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt" -OutFile $checksumPath
    $package = (Get-Content $checksumPath | ForEach-Object { if ($_ -match "^([a-fA-F0-9]{64})\\s+node-v[0-9.]+-win-$architecture\\.zip$") { $_.Split()[-1] } } | Select-Object -First 1)
    if (-not $package) { throw "Could not determine a supported Node.js 22 LTS download for this PC." }
    $expected = (Get-Content $checksumPath | Where-Object { $_ -match ("\\s" + [regex]::Escape($package) + "$") } | Select-Object -First 1).Split()[0]
    $archivePath = Join-Path $downloadDir $package
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/latest-v22.x/$package" -OutFile $archivePath
    $actual = (Get-FileHash -Algorithm SHA256 -Path $archivePath).Hash.ToLowerInvariant()
    if ($expected.ToLowerInvariant() -ne $actual) { throw "Node.js download checksum verification failed. Nothing was installed." }
    Expand-Archive -Path $archivePath -DestinationPath $downloadDir -Force
    $runtimeSource = Join-Path $downloadDir ([IO.Path]::GetFileNameWithoutExtension($package))
    if (-not (Test-Path $runtimeSource)) { throw "The verified Node.js archive did not contain the expected runtime folder." }
    Remove-Item -Recurse -Force $NodeRuntimeDir -ErrorAction SilentlyContinue
    Move-Item -Path $runtimeSource -Destination $NodeRuntimeDir
  }
  finally {
    Remove-Item -Recurse -Force $downloadDir -ErrorAction SilentlyContinue
  }
  Refresh-ClaudePath
  if (-not ((Get-Command node -ErrorAction SilentlyContinue) -and (Get-Command npm -ErrorAction SilentlyContinue) -and (Get-Command npx -ErrorAction SilentlyContinue))) {
    throw "Managed Node.js installation completed, but its commands are unavailable."
  }
  Add-Manifest -Kind "managed-runtime" -Target $NodeRuntimeDir -Extra "Official Node.js 22 LTS runtime for Claude Code Tools Installer." -ItemId "node-runtime"
  Write-Log "Installed managed Node.js runtime: $((& node --version 2>$null) -join ' ')"
}

function Ensure-Git {
  if (Get-Command git -ErrorAction SilentlyContinue) { return }
  if ($DryRun) { Write-Log "Dry run: would install Git for Windows with Windows Package Manager"; return }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw "Git is required, but Windows Package Manager is unavailable on this PC." }
  Write-Log "+ winget install Git.Git"
  & winget install --id Git.Git --exact --source winget --accept-source-agreements --accept-package-agreements --silent
  if ($LASTEXITCODE -ne 0) { throw "Git for Windows could not be installed (exit code $LASTEXITCODE)." }
  Refresh-ClaudePath
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git installation completed, but Git is unavailable in this setup session." }
}

function Start-FreshClaudeCode {
  if ($DryRun) {
    Write-Log "Dry run: would remove Claude Code binaries, versions, settings, session history, local tool configuration, and the app-managed Node.js runtime"
    return
  }
  Write-Log "Removing Claude Code native installation and local configuration for a clean setup"
  Remove-Item -Force (Join-Path $HOME ".local\bin\claude.exe") -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force (Join-Path $HOME ".local\share\claude"), (Join-Path $HOME ".claude\local"), (Join-Path $HOME ".claude"), (Join-Path $HOME ".claude.json"), $NodeRuntimeDir -ErrorAction SilentlyContinue
  if (Get-Command npm -ErrorAction SilentlyContinue) {
    & npm list -g @anthropic-ai/claude-code *> $null
    if ($LASTEXITCODE -eq 0) { & npm uninstall -g @anthropic-ai/claude-code | Out-Host }
  }
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    & winget list --id Anthropic.ClaudeCode --exact *> $null
    if ($LASTEXITCODE -eq 0) { & winget uninstall --id Anthropic.ClaudeCode --exact --silent --accept-source-agreements | Out-Host }
  }
  Set-Content -Path $Manifest -Value ""
  Set-Content -Path $PluginCommands -Value ""
  Write-Log "Start-fresh cleanup completed. The installer will now provision a new Claude Code setup."
}

function Get-ClaudeCommand {
  Refresh-ClaudePath
  return Get-Command claude -ErrorAction SilentlyContinue
}

function Start-ClaudeCode {
  param([string]$ClaudePath)

  if ($script:ClaudeLaunched) { return }
  if ($NoLaunch) {
    Write-Log "Claude Code is ready. PowerShell launch was skipped because the desktop app will guide the next step."
    return
  }
  if ($DryRun) {
    Write-Log "Dry run: would open Claude Code in a minimized background PowerShell window from $PWD"
    return
  }

  $pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
  if (-not $pwsh) {
    $pwsh = (Get-Command powershell -ErrorAction SilentlyContinue).Source
  }
  if (-not $pwsh) {
    Write-Log "Claude Code is installed, but a PowerShell host was not found to launch it. Run: cd '$PWD'; & '$ClaudePath'"
    return
  }

  $escapedPath = $ClaudePath.Replace("'", "''")
  $escapedDirectory = $PWD.Path.Replace("'", "''")
  $launchCommand = "Set-Location -LiteralPath '$escapedDirectory'; & '$escapedPath'"
  try {
    Start-Process -FilePath $pwsh -ArgumentList @("-NoExit", "-Command", $launchCommand) -WindowStyle Minimized | Out-Null
    $script:ClaudeLaunched = $true
    Write-Log "Opened Claude Code in a minimized background PowerShell window from $($PWD.Path)"
  }
  catch {
    Write-Log "Claude Code is installed, but it could not be opened automatically. Run: cd '$($PWD.Path)'; & '$ClaudePath'. Error: $($_.Exception.Message)"
  }
}

function Reuse-ActiveClaudeBootstrap {
  if (-not (Test-Path $ClaudeBootstrapState)) { return $false }
  $recordedPid = (Get-Content -Path $ClaudeBootstrapState -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($recordedPid -match '^\d+$') {
    $process = Get-Process -Id ([int]$recordedPid) -ErrorAction SilentlyContinue
    if ($process) {
      $script:ClaudeBootstrapProcess = $process
      Write-Log "Reusing existing Claude Code bootstrap (pid $($process.Id))."
      return $true
    }
  }
  Remove-Item -Path $ClaudeBootstrapState -Force -ErrorAction SilentlyContinue
  return $false
}

function Start-ClaudeBootstrap {
  $claude = Get-ClaudeCommand
  if ($claude) {
    Write-Log "Existing Claude Code detected: $($claude.Source)"
    if ($Complete) {
      Write-Log "Complete setup will open Claude Code after the recommended tools are ready."
    }
    else {
      Start-ClaudeCode -ClaudePath $claude.Source
    }
    return
  }
  if (Reuse-ActiveClaudeBootstrap) { return }

  if ($DryRun) {
    Write-Log "Dry run: would install Claude Code with Anthropic's official native installer in the background"
    return
  }

  $pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
  if (-not $pwsh) {
    $pwsh = (Get-Command powershell -ErrorAction SilentlyContinue).Source
  }
  if (-not $pwsh) {
    throw "Claude Code is missing and no PowerShell host is available to start Anthropic's official installer."
  }

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $script:ClaudeBootstrapStdOut = Join-Path $LogDir "claude-code-bootstrap-$timestamp.out.log"
  $script:ClaudeBootstrapStdErr = Join-Path $LogDir "claude-code-bootstrap-$timestamp.err.log"
  Write-Host "Claude Code is not installed. Starting Anthropic's official installer in the background while you make selections."
  $script:ClaudeBootstrapProcess = Start-Process -FilePath $pwsh -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://claude.ai/install.ps1 | iex") -PassThru -RedirectStandardOutput $script:ClaudeBootstrapStdOut -RedirectStandardError $script:ClaudeBootstrapStdErr
  Set-Content -Path $ClaudeBootstrapState -Value $script:ClaudeBootstrapProcess.Id
  Write-Log "Started Claude Code bootstrap in background (pid $($script:ClaudeBootstrapProcess.Id)). Logs: $($script:ClaudeBootstrapStdOut), $($script:ClaudeBootstrapStdErr)"
}

function Ensure-ClaudeReady {
  if ($DryRun) {
    Write-Log "Dry run: Claude Code bootstrap would complete before selected tools are installed"
    return
  }

  if ($script:ClaudeBootstrapProcess) {
    Write-Host "Waiting for Claude Code to finish installing before applying selected tools..."
    $script:ClaudeBootstrapProcess.WaitForExit()
    if ($script:ClaudeBootstrapProcess.ExitCode -ne 0) {
      Remove-Item -Path $ClaudeBootstrapState -Force -ErrorAction SilentlyContinue
      throw "Claude Code installation failed. Review: $($script:ClaudeBootstrapStdOut) and $($script:ClaudeBootstrapStdErr)"
    }
    Remove-Item -Path $ClaudeBootstrapState -Force -ErrorAction SilentlyContinue

    $claude = Get-ClaudeCommand
    if (-not $claude) {
      throw "Claude Code finished installing but is not available in this PowerShell session. Restart PowerShell, then rerun the installer. Logs: $($script:ClaudeBootstrapStdOut) and $($script:ClaudeBootstrapStdErr)"
    }

    Add-Manifest -Kind "manual-review" -Target $claude.Source -Extra "Installed by Claude Code's official native installer; manage updates and removal with Claude Code's documented commands." -ItemId "claude-code"
    Write-Log "Claude Code bootstrap completed: $($claude.Source)"
    if ($Complete) {
      Write-Log "Complete setup will open Claude Code after the recommended tools are ready."
    }
    else {
      Start-ClaudeCode -ClaudePath $claude.Source
    }
    return
  }

  $claude = Get-ClaudeCommand
  if ($claude) {
    if (-not $Complete) {
      Start-ClaudeCode -ClaudePath $claude.Source
    }
    return
  }

  throw "Claude Code is required to finish this setup, but the bootstrap did not start."
}

function Check-Dependencies {
  $missing = @()
  foreach ($cmd in @("node", "npm", "npx", "git")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
      $missing += $cmd
    }
  }

  if ($missing.Count -gt 0) {
    if ($Complete -and $DryRun) {
      Write-Log "Dry run: Complete setup would make the missing tool dependencies available before installing curated tools"
      return
    }
    Write-Host "Missing dependencies: $($missing -join ', ')"
    Write-Host "Complete setup could not prepare all required dependencies. Node.js/npm/npx and Git are required."
    exit 1
  }

  Write-Log "Tool dependency versions:"
  Write-Log "node: $((& node --version 2>$null) -join ' ')"
  Write-Log "npm: $((& npm --version 2>$null) -join ' ')"
  Write-Log "git: $((& git --version 2>$null) -join ' ')"
}

function Get-SourceVersion {
  param([string]$Source)
  try {
    if ($Source -like "https://github.com/*") {
      $result = & git ls-remote $Source HEAD 2>$null
      if ($result) {
        return ($result -split "\s+")[0]
      }
    }
    elseif ($Source -like "npm:*") {
      return (& npm view $Source.Substring(4) version 2>$null)
    }
  }
  catch {
    return ""
  }
  return ""
}

function Test-McpExists {
  param([string]$Name)
  if ($DryRun) {
    Write-Log "Dry run: would check whether MCP server '$Name' already exists; no Claude Code command will run"
    return $false
  }
  try {
    $list = & claude mcp list 2>$null
    return ($list | ForEach-Object { ($_ -split "\s+")[0] }) -contains $Name
  }
  catch {
    return $false
  }
}

function Clone-OrUpdate {
  param(
    [string]$Repo,
    [string]$Destination,
    [string]$ItemId
  )
  if (Test-Path (Join-Path $Destination ".git")) {
    Write-Log "Existing git checkout detected: $Destination"
    Invoke-Logged git @("-C", $Destination, "pull", "--ff-only")
  }
  elseif (Test-Path $Destination) {
    Write-Log "Existing non-git path detected, skipping clone: $Destination"
  }
  else {
    Invoke-Logged git @("clone", "--depth", "1", $Repo, $Destination)
    Add-Manifest "path" $Destination "" $ItemId
  }
}

function Install-Skill {
  param(
    [string]$Repo,
    [string]$Skill,
    [string]$ItemId
  )
  $dest = Join-Path $HOME ".claude\skills\$Skill"
  if (Test-Path $dest) {
    Write-Log "Existing skill detected: $dest"
    return
  }
  Invoke-Logged npx @("-y", "skills", "add", $Repo, "--skill", $Skill, "--agent", "claude-code")
  Add-Manifest "skill" $dest "" $ItemId
}

function Install-NpmGlobal {
  param(
    [string]$Package,
    [string]$Bin,
    [string]$ItemId
  )
  if (Get-Command $Bin -ErrorAction SilentlyContinue) {
    Write-Log "Existing command detected: $Bin"
    return
  }
  Invoke-Logged npm @("install", "-g", $Package)
  Add-Manifest "npm-global" $Package $Bin $ItemId
}

function Install-Mcp {
  param(
    [string]$Name,
    [string]$ItemId,
    [string[]]$Arguments
  )
  if (Test-McpExists $Name) {
    Write-Log "Existing MCP server detected: $Name"
    return
  }
  Invoke-Logged claude (@("mcp", "add", $Name) + $Arguments)
  Add-Manifest "mcp" $Name "" $ItemId
}

function Install-McpAfterDashDash {
  param(
    [string]$Name,
    [string]$ItemId,
    [string[]]$Arguments
  )
  if (Test-McpExists $Name) {
    Write-Log "Existing MCP server detected: $Name"
    return
  }
  Invoke-Logged claude (@("mcp", "add", $Name, "--") + $Arguments)
  Add-Manifest "mcp" $Name "" $ItemId
}

function Get-ItemTable {
  @(
    [pscustomobject]@{ Id="learn-claude-code"; Name="Learn Claude Code"; Category="harness"; Classification="harness/framework"; Default=$false; Action="clone reference repo" }
    [pscustomobject]@{ Id="karpathy-skills"; Name="Karpathy Skills"; Category="harness"; Classification="memory/context utility"; Default=$false; Action="clone reference repo" }
    [pscustomobject]@{ Id="superpowers"; Name="Superpowers"; Category="harness"; Classification="plugin/skills framework"; Default=$true; Action="queue Claude plugin commands" }
    [pscustomobject]@{ Id="ponytail"; Name="Ponytail"; Category="harness"; Classification="skill"; Default=$false; Action="npx skills add" }
    [pscustomobject]@{ Id="gstack"; Name="gstack"; Category="harness"; Classification="skill pack/harness"; Default=$true; Action="clone to ~/.claude/skills and run setup" }
    [pscustomobject]@{ Id="ecc"; Name="ECC"; Category="harness"; Classification="plugin/harness/security"; Default=$false; Action="queue Claude plugin commands" }
    [pscustomobject]@{ Id="taste-skill"; Name="taste-skill"; Category="skills"; Classification="skill"; Default=$true; Action="npx skills add" }
    [pscustomobject]@{ Id="anthropic-skills"; Name="anthropics/skills"; Category="skills"; Classification="official skills marketplace"; Default=$true; Action="queue Claude plugin marketplace commands" }
    [pscustomobject]@{ Id="wshobson-agents"; Name="wshobson/agents"; Category="skills"; Classification="plugin marketplace/subagents"; Default=$false; Action="queue Claude plugin commands" }
    [pscustomobject]@{ Id="claude-plugins-official"; Name="claude-plugins-official"; Category="skills"; Classification="official plugin marketplace"; Default=$false; Action="queue browse/install note" }
    [pscustomobject]@{ Id="frontend-design"; Name="Frontend Design"; Category="popular"; Classification="official Claude Code plugin"; Default=$false; Action="queue official plugin command for review" }
    [pscustomobject]@{ Id="code-review"; Name="Code Review"; Category="popular"; Classification="official Claude Code plugin"; Default=$false; Action="queue official plugin command for review" }
    [pscustomobject]@{ Id="context7"; Name="Context7"; Category="popular"; Classification="official Claude Code plugin"; Default=$false; Action="queue official plugin command for review" }
    [pscustomobject]@{ Id="skill-creator"; Name="Skill Creator"; Category="popular"; Classification="official Claude Code plugin"; Default=$false; Action="queue official plugin command for review" }
    [pscustomobject]@{ Id="ui-ux-pro-max"; Name="ui-ux-pro-max"; Category="skills"; Classification="skill/reference"; Default=$false; Action="clone reference repo" }
    [pscustomobject]@{ Id="awesome-claude-skills"; Name="awesome-claude-skills"; Category="skills"; Classification="catalog/reference"; Default=$false; Action="clone reference repo" }
    [pscustomobject]@{ Id="planning-with-files"; Name="planning-with-files"; Category="memory"; Classification="skill"; Default=$true; Action="npx skills add" }
    [pscustomobject]@{ Id="claude-mem"; Name="Claude-Mem"; Category="memory"; Classification="memory/context utility"; Default=$false; Action="npx claude-mem install" }
    [pscustomobject]@{ Id="codegraph"; Name="CodeGraph"; Category="memory"; Classification="CLI/tool"; Default=$false; Action="npm global install" }
    [pscustomobject]@{ Id="graphify"; Name="Graphify"; Category="memory"; Classification="skill/CLI"; Default=$false; Action="npx skills add" }
    [pscustomobject]@{ Id="repomix"; Name="Repomix"; Category="memory"; Classification="CLI/MCP server"; Default=$true; Action="npm global plus claude mcp add" }
    [pscustomobject]@{ Id="convex"; Name="Convex for Claude Code"; Category="tools"; Classification="official Convex plugin"; Default=$false; Action="queue plugin command for Convex skills, agents, MCP access, monitors, and rules" }
    [pscustomobject]@{ Id="multica"; Name="Multica"; Category="tools"; Classification="harness/framework"; Default=$false; Action="clone reference repo only" }
    [pscustomobject]@{ Id="firecrawl"; Name="Firecrawl"; Category="tools"; Classification="plugin/MCP/CLI"; Default=$false; Action="npm CLI plus plugin command note" }
    [pscustomobject]@{ Id="cc-switch"; Name="CC Switch"; Category="tools"; Classification="desktop CLI/tool"; Default=$false; Action="manual review on Windows" }
    [pscustomobject]@{ Id="vibe-kanban"; Name="Vibe Kanban"; Category="tools"; Classification="desktop/web tool"; Default=$false; Action="document only; project sunsetting" }
    [pscustomobject]@{ Id="github-mcp"; Name="GitHub MCP"; Category="tools"; Classification="MCP server"; Default=$false; Action="credential-sensitive command note" }
    [pscustomobject]@{ Id="playwright-mcp"; Name="Playwright MCP"; Category="tools"; Classification="MCP server"; Default=$true; Action="claude mcp add" }
    [pscustomobject]@{ Id="claude-code-router"; Name="Claude Code Router"; Category="tools"; Classification="CLI/router"; Default=$false; Action="npm global install" }
    [pscustomobject]@{ Id="awesome-mcp-servers"; Name="awesome-mcp-servers"; Category="tools"; Classification="catalog/reference"; Default=$false; Action="clone reference repo" }
    [pscustomobject]@{ Id="system-prompts-ai"; Name="system-prompts-ai"; Category="cost"; Classification="reference/research"; Default=$false; Action="clone reference repo" }
    [pscustomobject]@{ Id="best-practice"; Name="claude-code-best-practice"; Category="cost"; Classification="reference/workflows"; Default=$false; Action="clone reference repo" }
    [pscustomobject]@{ Id="codex-plugin-cc"; Name="Codex in Claude"; Category="cost"; Classification="CLI/plugin integration"; Default=$false; Action="manual review note" }
    [pscustomobject]@{ Id="claude-hud"; Name="Claude HUD"; Category="cost"; Classification="plugin/monitoring"; Default=$true; Action="queue Claude plugin commands" }
    [pscustomobject]@{ Id="caveman"; Name="Caveman"; Category="cost"; Classification="cost/token workflow"; Default=$false; Action="clone reference repo" }
  )
}

function Select-Items {
  $table = Get-ItemTable
  if ($All) {
    return $table.Id
  }
  if ($Item) {
    return ($Item -split "," | Where-Object { $_.Trim() } | ForEach-Object { $_.Trim() })
  }
  if ($Category) {
    $categories = $Category -split "," | ForEach-Object { $_.Trim() }
    return ($table | Where-Object { $categories -contains $_.Category }).Id
  }
  if ($Defaults) {
    return ($table | Where-Object { $_.Default }).Id
  }

  Write-Host "`nAvailable items:"
  $table | ForEach-Object {
    "{0,-24} {1,-10} {2,-28} default:{3}" -f $_.Id, $_.Category, $_.Classification, $_.Default
  } | Write-Host

  $answer = Read-Host "`nUse curated defaults? [Y/n]"
  if ([string]::IsNullOrWhiteSpace($answer) -or $answer -match "^[Yy]$") {
    return ($table | Where-Object { $_.Default }).Id
  }

  $manual = Read-Host "Enter comma-separated item ids, category names, or 'all'"
  if ($manual -eq "all") {
    return $table.Id
  }

  $selected = New-Object System.Collections.Generic.List[string]
  foreach ($part in ($manual -split ",")) {
    $part = $part.Trim()
    if (-not $part) { continue }
    if (($table.Category | Select-Object -Unique) -contains $part) {
      ($table | Where-Object { $_.Category -eq $part }).Id | ForEach-Object { $selected.Add($_) }
    }
    else {
      $selected.Add($part)
    }
  }
  return $selected.ToArray()
}

function Install-Item {
  param([string]$Id)
  switch ($Id) {
    "learn-claude-code" {
      Write-Log "Source learn-claude-code HEAD: $(Get-SourceVersion 'https://github.com/shareAI-lab/learn-claude-code')"
      Clone-OrUpdate "https://github.com/shareAI-lab/learn-claude-code" (Join-Path $CloneDir "learn-claude-code") $Id
    }
    "karpathy-skills" {
      Write-Log "Source karpathy-skills HEAD: $(Get-SourceVersion 'https://github.com/multica-ai/andrej-karpathy-skills')"
      Clone-OrUpdate "https://github.com/multica-ai/andrej-karpathy-skills" (Join-Path $CloneDir "andrej-karpathy-skills") $Id
    }
    "superpowers" {
      Add-PluginCommand "Superpowers" "/plugin marketplace add obra/superpowers-marketplace`n/plugin install superpowers@superpowers-marketplace`n/reload-plugins" "https://github.com/obra/superpowers and https://github.com/obra/superpowers-marketplace"
      Write-Log "Queued Superpowers Claude Code plugin commands in $PluginCommands"
    }
    "ponytail" {
      Install-Skill "https://github.com/DietrichGebert/ponytail" "ponytail" $Id
    }
    "gstack" {
      $dest = Join-Path $HOME ".claude\skills\gstack"
      Write-Log "Source gstack HEAD: $(Get-SourceVersion 'https://github.com/garrytan/gstack')"
      if (Test-Path (Join-Path $dest ".git")) {
        Write-Log "Existing gstack checkout detected: $dest"
      }
      else {
        Invoke-Logged git @("clone", "--single-branch", "--depth", "1", "https://github.com/garrytan/gstack.git", $dest)
        Add-Manifest "path" $dest "" $Id
      }
      $setup = Join-Path $dest "setup"
      if (Test-Path $setup) {
        Write-Log "gstack's final setup is Unix-only. CCTI did not run it on Windows; a future Windows-compatible app path is required."
      }
      else {
        Write-Log "gstack setup script not found at $setup"
      }
    }
    "ecc" {
      Add-PluginCommand "ECC" "/plugin marketplace add https://github.com/affaan-m/ECC`n/plugin install ecc@ecc`n/reload-plugins" "https://github.com/affaan-m/ECC"
      Write-Log "Queued ECC plugin commands in $PluginCommands"
    }
    "taste-skill" {
      Install-Skill "https://github.com/Leonxlnx/taste-skill" "design-taste-frontend" $Id
    }
    "anthropic-skills" {
      Add-PluginCommand "Anthropic Agent Skills" "/plugin marketplace add anthropics/skills`n/plugin`n# Browse anthropic-agent-skills, then install document-skills or example-skills as needed." "https://github.com/anthropics/skills"
      Write-Log "Queued Anthropic skills marketplace commands in $PluginCommands"
    }
    "wshobson-agents" {
      Add-PluginCommand "wshobson agents" "/plugin marketplace add https://github.com/wshobson/agents`n/plugin install claude-code-essentials`n/reload-plugins" "https://github.com/wshobson/agents"
      Write-Log "Queued wshobson agents plugin commands in $PluginCommands"
    }
    "claude-plugins-official" {
      Add-PluginCommand "Anthropic official plugin marketplace" "/plugin`n# Browse Discover / claude-plugins-official and install only the plugins you need.`n# /plugin install {plugin-name}@claude-plugins-official" "https://github.com/anthropics/claude-plugins-official"
      Write-Log "Queued official plugin marketplace note in $PluginCommands"
    }
    "frontend-design" {
      Add-PluginCommand "Frontend Design" "/plugin install frontend-design@claude-plugins-official`n/reload-plugins" "https://claude.com/plugins/frontend-design"
      Write-Log "Queued Frontend Design plugin command in $PluginCommands"
    }
    "code-review" {
      Add-PluginCommand "Code Review" "/plugin install code-review@claude-plugins-official`n/reload-plugins" "https://claude.com/plugins/code-review"
      Write-Log "Queued Code Review plugin command in $PluginCommands"
    }
    "context7" {
      Add-PluginCommand "Context7" "/plugin install context7@claude-plugins-official`n/reload-plugins" "https://claude.com/plugins/context7"
      Write-Log "Queued Context7 plugin command in $PluginCommands"
    }
    "skill-creator" {
      Add-PluginCommand "Skill Creator" "/plugin install skill-creator@claude-plugins-official`n/reload-plugins" "https://claude.com/plugins/skill-creator"
      Write-Log "Queued Skill Creator plugin command in $PluginCommands"
    }
    "ui-ux-pro-max" {
      Clone-OrUpdate "https://github.com/nextlevelbuilders/ui-ux-pro-max" (Join-Path $CloneDir "ui-ux-pro-max") $Id
    }
    "awesome-claude-skills" {
      Clone-OrUpdate "https://github.com/ComposioHQ/awesome-claude-skills" (Join-Path $CloneDir "awesome-claude-skills") $Id
    }
    "planning-with-files" {
      Install-Skill "https://github.com/OthmanAdi/planning-with-files" "planning-with-files" $Id
    }
    "claude-mem" {
      Invoke-Logged npx @("-y", "claude-mem", "install")
      Add-Manifest "manual-review" "claude-mem" "Run claude-mem docs uninstall steps if needed; data may live in ~/.claude-mem" $Id
    }
    "codegraph" {
      Install-NpmGlobal "@colbymchenry/codegraph" "codegraph" $Id
    }
    "graphify" {
      Install-Skill "https://github.com/Graphify-Labs/graphify" "graphify" $Id
    }
    "repomix" {
      Install-NpmGlobal "repomix" "repomix" $Id
      Install-McpAfterDashDash "repomix" $Id @("npx", "-y", "repomix", "--mcp")
    }
    "convex" {
      Add-PluginCommand "Convex for Claude Code" "/plugin install convex@claude-plugins-official`n/reload-plugins`n# Open a Convex project before using deployment access. The plugin may request a deployment connection when needed." "https://docs.convex.dev/ai/using-claude-code"
      Write-Log "Queued the official Convex plugin command in $PluginCommands"
    }
    "multica" {
      Clone-OrUpdate "https://github.com/multica-ai/multica" (Join-Path $CloneDir "multica") $Id
      Write-Log "Multica self-hosting requires Docker and make; not started by this installer."
    }
    "firecrawl" {
      Install-NpmGlobal "firecrawl-cli" "firecrawl" $Id
      Add-PluginCommand "Firecrawl Claude plugin" "/plugin`n# Search for firecrawl and install it, then provide FIRECRAWL_API_KEY when the plugin or MCP server asks for it." "https://github.com/firecrawl/firecrawl-claude-plugin"
      Write-Log "Firecrawl CLI installed or detected. Plugin command queued in $PluginCommands"
    }
    "cc-switch" {
      Write-Log "CC Switch install is not automated on Windows. Review releases manually: https://github.com/farion1231/cc-switch/releases"
    }
    "vibe-kanban" {
      Write-Log "Vibe Kanban is sunsetting, so CCTI did not install it."
    }
    "github-mcp" {
      Add-PluginCommand "GitHub MCP" "# Credential-sensitive. Prefer Claude's built-in connector or run a scoped PAT setup manually.`n# claude mcp add github -e GITHUB_PERSONAL_ACCESS_TOKEN=YOUR_TOKEN -- docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server" "https://github.com/github/github-mcp-server"
      Write-Log "Queued GitHub MCP setup notes in $PluginCommands"
    }
    "playwright-mcp" {
      Install-Mcp "playwright" $Id @("npx", "@playwright/mcp@latest")
    }
    "claude-code-router" {
      Install-NpmGlobal "@musistudio/claude-code-router" "ccr" $Id
      Write-Log "Claude Code Router installed or detected. Configure providers before using 'ccr code'."
    }
    "awesome-mcp-servers" {
      Clone-OrUpdate "https://github.com/punkpeye/awesome-mcp-servers" (Join-Path $CloneDir "awesome-mcp-servers") $Id
    }
    "system-prompts-ai" {
      Clone-OrUpdate "https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools" (Join-Path $CloneDir "system-prompts-and-models-of-ai-tools") $Id
    }
    "best-practice" {
      Clone-OrUpdate "https://github.com/shanraisshan/claude-code-best-practice" (Join-Path $CloneDir "claude-code-best-practice") $Id
    }
    "codex-plugin-cc" {
      Add-PluginCommand "OpenAI Codex in Claude Code" "# This item points to the OpenAI Codex repository/ecosystem.`n# Install Codex separately from official OpenAI documentation, then add any Claude plugin only if the repo documents one for your version.`n# Repository: https://github.com/openai/codex" "https://github.com/openai/codex"
      Write-Log "Queued Codex integration review note in $PluginCommands"
    }
    "claude-hud" {
      Add-PluginCommand "Claude HUD" "/plugin marketplace add jarrodwatts/claude-hud`n/plugin install claude-hud`n/reload-plugins`n# After install, run /claude-hud:setup in Claude Code if prompted." "https://github.com/jarrodwatts/claude-hud"
      Write-Log "Queued Claude HUD plugin commands in $PluginCommands"
    }
    "caveman" {
      Clone-OrUpdate "https://github.com/JuliusBrussel/caveman" (Join-Path $CloneDir "caveman") $Id
    }
    default {
      Write-Log "Unknown item id: $Id"
      throw "Unknown item id: $Id"
    }
  }
}

function Uninstall-Manifest {
  if (-not (Test-Path $Manifest) -or ((Get-Item $Manifest).Length -eq 0)) {
    Write-Host "No manifest found at $Manifest"
    exit 0
  }

  Write-Host "Rollback uses the manifest at $Manifest"
  if (-not $Yes) {
    $answer = Read-Host "Proceed with rollback of recorded paths/MCP/npm installs? [y/N]"
    if ($answer -notmatch "^[Yy]$") { exit 0 }
  }

  $lines = Get-Content $Manifest
  [array]::Reverse($lines)
  foreach ($line in $lines) {
    $parts = $line -split "`t", 5
    if ($parts.Count -lt 5) { continue }
    $kind = $parts[1]
    $target = $parts[2]
    $extra = $parts[3]
    $itemId = $parts[4]
    switch ($kind) {
      "path" {
        if (Test-Path $target) {
          Write-Log "+ Remove-Item -Recurse -Force $target"
          if (-not $DryRun) { Remove-Item -Recurse -Force $target }
        }
      }
      "skill" {
        if (Test-Path $target) {
          Write-Log "+ Remove-Item -Recurse -Force $target"
          if (-not $DryRun) { Remove-Item -Recurse -Force $target }
        }
      }
      "mcp" {
        if (Test-McpExists $target) {
          Invoke-Logged claude @("mcp", "remove", $target)
        }
      }
      "npm-global" {
        Invoke-Logged npm @("uninstall", "-g", $target)
      }
      "managed-runtime" {
        if (Test-Path $target) {
          Write-Log "+ Remove-Item -Recurse -Force $target"
          if (-not $DryRun) { Remove-Item -Recurse -Force $target }
        }
      }
      "manual-review" {
        Write-Log "Manual rollback review required for $itemId`: $target $extra"
      }
    }
  }
}

Write-Log "setup-my-claude.ps1 version $ScriptVersion"
Write-Log "Dry run: $DryRun"

if ($Uninstall) {
  Check-Dependencies
  Uninstall-Manifest
  exit 0
}

if ($Fresh) { Start-FreshClaudeCode }
if ($Complete) {
  Ensure-NodeRuntime
  Ensure-Git
}

Start-ClaudeBootstrap
if ($ClaudeOnly) {
  Ensure-ClaudeReady
  if ($DryRun) { Write-Host "Dry run: Claude Code installation would run and be checked before this command finishes." }
  else { Write-Host "Claude Code is installed and ready." }
  exit 0
}
if ($BootstrapOnly) {
  Write-Host "Claude Code preparation has started. You can continue selecting tools in the desktop installer."
  exit 0
}

Check-Dependencies

$selected = @(Select-Items)
if ($selected.Count -eq 0) {
  Write-Host "No items selected."
  exit 0
}

Write-Host "`nSelected items:"
$selected | ForEach-Object { Write-Host "  $_" }
Write-Host ""

if (-not $Yes -and -not $DryRun) {
  $answer = Read-Host "Proceed? [y/N]"
  if ($answer -notmatch "^[Yy]$") { exit 0 }
}

Ensure-ClaudeReady

if (-not $DryRun) {
  Set-Content -Path $PluginCommands -Value @"
# Claude Code plugin commands

Generated by setup-my-claude.ps1 on $(Get-Date).

Some Claude Code plugins must be installed from inside Claude Code with slash commands.
This installer does not paste or execute those commands for you.
"@
}
else {
  Write-Log "Dry run: would prepare the Claude Code plugin command checklist"
}

foreach ($id in $selected) {
  Write-Log "Installing or queuing: $id"
  Install-Item $id
}

Write-Host ""
Write-Host "Done."
Write-Host "Log: $LogFile"
Write-Host "Manifest: $Manifest"
Write-Host "Claude plugin command queue: $PluginCommands"
if ($Complete -and -not $DryRun) {
  $claude = Get-ClaudeCommand
  if ($claude) { Start-ClaudeCode -ClaudePath $claude.Source }
}
Write-Host ""
Write-Host "Open Claude Code and run the queued slash commands for plugin items."
