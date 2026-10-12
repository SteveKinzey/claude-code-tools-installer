param([string]$Root, [string]$Adapter)
$ErrorActionPreference = 'Stop'
# Runs in a separate PowerShell process with an entirely disposable HOME.
function Assert-Fixture { param([bool]$Condition, [string]$Message) if (-not $Condition) { throw $Message } }
$fixtureHome = Join-Path $Root 'windows-home'
$project = Join-Path $Root 'windows-project'
New-Item -ItemType Directory -Path $fixtureHome, $project | Out-Null
Set-Variable -Name HOME -Value $fixtureHome -Scope Global -Force
Set-Location $project
function node { 'fixture-node' }
function npm { 'fixture-npm' }
function npx { throw 'Dry-run must not execute npx' }
function git { 'fixture-git' }
function claude { throw 'Dry-run must not execute Claude' }
$emptyOutput = (& $Adapter -Uninstall -DryRun -Yes 6>&1 | Out-String)
Assert-Fixture ($LASTEXITCODE -eq 0) 'Empty-home adapter dry run failed'
Assert-Fixture (@(Get-ChildItem $HOME -Force).Count -eq 0) 'Empty-home dry run wrote state'
$BaseDir = Join-Path $HOME '.setup-my-claude'
$CloneDir = Join-Path $HOME '.claude/reference-repos'
$NodeRuntimeDir = Join-Path $BaseDir 'node-runtime'
$legitimate = @(
  (Join-Path $CloneDir 'learn-claude-code'),
  (Join-Path $HOME '.claude/skills/gstack'),
  (Join-Path $project '.claude/skills/design-taste-frontend'),
  $NodeRuntimeDir
)
foreach ($folder in $legitimate) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
$outside = Join-Path $Root 'windows-outside'
New-Item -ItemType Directory -Path (Join-Path $outside 'protected') -Force | Out-Null
$sentinel = Join-Path $outside 'protected/DO-NOT-DELETE'
Set-Content -LiteralPath $sentinel -Value 'fixture sentinel'
$junction = Join-Path $CloneDir 'multica'
New-Item -ItemType Junction -Path $junction -Target $outside | Out-Null
# Test actual helper definitions, extracted with PowerShell's parser, not reimplemented mocks.
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Adapter, [ref]$tokens, [ref]$errors)
Assert-Fixture ($errors.Count -eq 0) 'Adapter parse failed'
foreach ($name in @('Get-RollbackExpectedPath','Test-RollbackPathHasReparsePoint','Test-RollbackPathIsSafe')) {
  $functionAst = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  Assert-Fixture ($null -ne $functionAst) "Missing real helper: $name"
  Invoke-Expression $functionAst.Extent.Text
}
$normalizedReference = $legitimate[0].Replace('\', '/')
Assert-Fixture (Test-RollbackPathIsSafe $normalizedReference $legitimate[0]) 'Forward-slash approved reference path rejected'
Assert-Fixture (Test-RollbackPathIsSafe $legitimate[0].ToUpperInvariant() $legitimate[0]) 'Case-insensitive approved reference path rejected'
$projectSkill = $legitimate[2].Replace('\', '/')
$expectedSkill = Get-RollbackExpectedPath 'skill' 'taste-skill' $projectSkill
Assert-Fixture ($null -ne $expectedSkill) 'Normalized project skill did not map to its expected path'
Assert-Fixture (Test-RollbackPathIsSafe $projectSkill $expectedSkill) 'Normalized project skill rejected'
Assert-Fixture (-not (Test-RollbackPathIsSafe $junction $junction)) 'Junction destination allowed'
Assert-Fixture (-not (Test-RollbackPathIsSafe (Join-Path $junction 'protected') (Join-Path $junction 'protected'))) 'Path beneath junction allowed'
Assert-Fixture (-not (Test-RollbackPathIsSafe (Join-Path $CloneDir 'learn-claude-code/../multica') $legitimate[0])) 'Traversal allowed'
Assert-Fixture (-not (Test-RollbackPathIsSafe 'relative' $legitimate[0])) 'Relative target allowed'
Assert-Fixture (-not (Test-RollbackPathIsSafe $HOME $HOME)) 'HOME target allowed'
Assert-Fixture (-not (Test-RollbackPathIsSafe ([IO.Path]::GetPathRoot($HOME)) ([IO.Path]::GetPathRoot($HOME)))) 'Filesystem root allowed'
Assert-Fixture (-not (Test-RollbackPathIsSafe $legitimate[0] $NodeRuntimeDir)) 'Mismatched item path allowed'
$records = @(
  @('path', $normalizedReference, '', 'learn-claude-code'),
  @('path', $legitimate[1], '', 'gstack'),
  @('skill', $projectSkill, '', 'taste-skill'),
  @('managed-runtime', $legitimate[3], '', 'node-runtime'),
  @('path', $junction, '', 'multica'),
  @('path', (Join-Path $junction 'protected'), '', 'multica'),
  @('path', $HOME, '', 'gstack'),
  @('path', 'relative', '', 'gstack'),
  @('path', (Join-Path $CloneDir 'learn-claude-code/../multica'), '', 'learn-claude-code'),
  @('path', $outside, '', 'learn-claude-code')
)
$manifest = Join-Path $BaseDir 'manifest.tsv'
$records | ForEach-Object { 'fixture' + "`t" + ($_ -join "`t") } | Set-Content -LiteralPath $manifest
$before = Get-Content -LiteralPath $manifest -Raw
$output = (& $Adapter -Uninstall -DryRun -Yes 6>&1 | Out-String)
Assert-Fixture ($LASTEXITCODE -eq 0) "Manifest dry run failed: $output"
Assert-Fixture (([regex]::Matches($output, '\+ Remove-Item -Recurse -Force ')).Count -eq 4) "Expected exactly four approved removal previews: $output"
Assert-Fixture (([regex]::Matches($output, 'Skipping untrusted manifest entry')).Count -ge 6) 'Unsafe records were not reported'
foreach ($target in $legitimate) { Assert-Fixture (Test-Path -LiteralPath $target -PathType Container) 'Dry run removed approved target' }
Assert-Fixture ((Get-Content -LiteralPath $manifest -Raw) -eq $before) 'Dry run changed manifest'
Assert-Fixture ((Get-Content -LiteralPath $sentinel).Trim() -eq 'fixture sentinel') 'Junction sentinel changed'
Assert-Fixture (@(Get-ChildItem $BaseDir -Force).Count -eq 2) 'Dry run created logs or extra state'
# Remove only the disposable link before Node deletes its fixture root.
[IO.Directory]::Delete($junction)
Write-Output 'Native Windows rollback fixtures passed: normalized paths, case parity, exact item boundaries, junction and descendant refusal, traversal/root/HOME refusal, and -Uninstall -DryRun -Yes no mutation.'
