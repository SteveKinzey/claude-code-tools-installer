param(
  [switch]$DryRun,
  [switch]$Defaults,
  [switch]$All,
  [switch]$Yes,
  [switch]$Uninstall,
  [Alias("Items")]
  [string]$Item = "",
  [Alias("Categories")]
  [string]$Category = "",
  [switch]$Help
)

$ErrorActionPreference = "Stop"
$ScriptVersion = "2026-08-13"
$BaseDir = Join-Path $HOME ".setup-my-claude"
$CloneDir = Join-Path $HOME ".claude\reference-repos"
$LogDir = Join-Path $BaseDir "logs"
$Manifest = Join-Path $BaseDir "manifest.tsv"
$PluginCommands = Join-Path $BaseDir "claude-plugin-commands.md"

function Show-Usage {
  @"
setup-my-claude.ps1

Safe interactive Windows PowerShell installer for a curated Claude Code extension stack.

Usage:
  pwsh -File .\setup-my-claude.ps1                         Interactive selection
  pwsh -File .\setup-my-claude.ps1 -Defaults               Install curated defaults
  pwsh -File .\setup-my-claude.ps1 -DryRun                 Show what would happen
  pwsh -File .\setup-my-claude.ps1 -Item id,id             Install specific item ids
  pwsh -File .\setup-my-claude.ps1 -Category cat           Install a category: harness,skills,memory,tools,cost
  pwsh -File .\setup-my-claude.ps1 -All                    Select every installable item
  pwsh -File .\setup-my-claude.ps1 -Uninstall              Roll back items recorded in the manifest

Options can be combined, for example:
  pwsh -File .\setup-my-claude.ps1 -Defaults -DryRun
"@
}

if ($Help) {
  Show-Usage
  exit 0
}

New-Item -ItemType Directory -Force -Path $BaseDir, $CloneDir, $LogDir | Out-Null
$LogFile = Join-Path $LogDir ("run-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType File -Force -Path $Manifest, $LogFile, $PluginCommands | Out-Null

function Write-Log {
  param([string]$Message)
  $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"), $Message
  Write-Host $line
  Add-Content -Path $LogFile -Value $line
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
  $line = "{0}`t{1}`t{2}`t{3}`t{4}" -f (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"), $Kind, $Target, $Extra, $ItemId
  Add-Content -Path $Manifest -Value $line
}

function Add-PluginCommand {
  param(
    [string]$Title,
    [string]$Commands,
    [string]$Source
  )
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

function Check-Dependencies {
  $missing = @()
  foreach ($cmd in @("claude", "node", "npm", "npx", "git")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
      $missing += $cmd
    }
  }

  if ($missing.Count -gt 0) {
    Write-Host "Missing dependencies: $($missing -join ', ')"
    Write-Host "Install Claude Code, Node.js/npm/npx, and Git first."
    exit 1
  }

  Write-Log "Dependency versions:"
  Write-Log "claude: $((& claude --version 2>$null) -join ' ')"
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
    [pscustomobject]@{ Id="ui-ux-pro-max"; Name="ui-ux-pro-max"; Category="skills"; Classification="skill/reference"; Default=$false; Action="clone reference repo" }
    [pscustomobject]@{ Id="awesome-claude-skills"; Name="awesome-claude-skills"; Category="skills"; Classification="catalog/reference"; Default=$false; Action="clone reference repo" }
    [pscustomobject]@{ Id="planning-with-files"; Name="planning-with-files"; Category="memory"; Classification="skill"; Default=$true; Action="npx skills add" }
    [pscustomobject]@{ Id="claude-mem"; Name="Claude-Mem"; Category="memory"; Classification="memory/context utility"; Default=$false; Action="npx claude-mem install" }
    [pscustomobject]@{ Id="codegraph"; Name="CodeGraph"; Category="memory"; Classification="CLI/tool"; Default=$false; Action="npm global install" }
    [pscustomobject]@{ Id="graphify"; Name="Graphify"; Category="memory"; Classification="skill/CLI"; Default=$false; Action="npx skills add" }
    [pscustomobject]@{ Id="repomix"; Name="Repomix"; Category="memory"; Classification="CLI/MCP server"; Default=$true; Action="npm global plus claude mcp add" }
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
        Write-Log "gstack setup exists but is a Unix script; run it under WSL/Git Bash if required."
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
      Write-Log "Vibe Kanban repository says the product is sunsetting; install is skipped unless you run npm manually."
      Write-Log "Verified npm package: npm install -g vibe-kanban"
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

Set-Content -Path $PluginCommands -Value @"
# Claude Code plugin commands

Generated by setup-my-claude.ps1 on $(Get-Date).

Some Claude Code plugins must be installed from inside Claude Code with slash commands.
This installer does not paste or execute those commands for you.
"@

foreach ($id in $selected) {
  Write-Log "Installing or queuing: $id"
  Install-Item $id
}

Write-Host ""
Write-Host "Done."
Write-Host "Log: $LogFile"
Write-Host "Manifest: $Manifest"
Write-Host "Claude plugin command queue: $PluginCommands"
Write-Host ""
Write-Host "Open Claude Code and run the queued slash commands for plugin items."
