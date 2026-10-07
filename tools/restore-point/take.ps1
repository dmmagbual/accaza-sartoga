<#
  Accaza restore point (Purchases & Payments Consolidation Plan, gate R0).
  Run from the MAIN project folder (where the Firebase CLI is signed in with the owner account)
  BEFORE merging any change that will be deployed to production.

  Layers (used in this order if anything goes wrong):
    (a) Code   - tags origin/main as restore/<Task>-<stamp> (and the last successfully deployed
                 Functions commit, if different) and pushes the tags.
    (b) Switch - feature flags live in /config, which is snapshotted.
    (c) Data   - notes the automated DAILY Realtime Database backup (not downloaded) and saves a
                 small snapshot of the allow-listed settings/counter nodes, each with a sha256.

  Output goes OUTSIDE the repository: %USERPROFILE%\AccazaRestorePoints\<tag>\  (never commit or upload it)
  Usage:  .\tools\restore-point\take.ps1 -Task "cash-voucher-1-2"
#>
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9][a-z0-9.-]{1,60}$')][string]$Task,
  [ValidateSet('accaza-sartoga', 'accazacoffeepos-uat')][string]$Project = 'accaza-sartoga',
  [string[]]$Nodes = @('config', 'documentCounters', 'pettyCashCounter', 'booksChart', 'cfAccounts')
)
$ErrorActionPreference = 'Stop'
# Allow-list only: small settings / counter nodes. Anything else (transactions, customers, ...) is refused.
$Allowed = @('config', 'documentCounters', 'pettyCashCounter', 'booksChart', 'cfAccounts')
$MaxBytes = 524288
foreach ($n in $Nodes) { if ($Allowed -cnotcontains $n.Trim('/')) { throw "Refusing to snapshot '$n': only $($Allowed -join ', ') belong in a restore point." } }
if (-not (Test-Path -LiteralPath '.git')) { throw 'Run this from the main project folder (the one that contains .git).' }
function Write-NoBom([string]$Path, [string]$Text) { [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false)) }

git fetch -q origin
if ($LASTEXITCODE -ne 0) { throw 'git fetch failed' }
$sha = (git rev-parse origin/main).Trim()
if ($LASTEXITCODE -ne 0) { throw 'cannot read origin/main' }
$deployJson = gh run list --workflow deploy-functions.yml --branch main --status success -L 1 --json databaseId,headSha,conclusion,createdAt,displayTitle
if ($LASTEXITCODE -ne 0) { throw 'gh run list failed (is gh signed in?)' }
$deploy = ($deployJson | ConvertFrom-Json) | Select-Object -First 1

$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$tag = "restore/$Task-$stamp"
git tag -a $tag $sha -m "Restore point before $Task (origin/main $sha)"
if ($LASTEXITCODE -ne 0) { throw 'git tag failed' }
git push -q origin $tag
if ($LASTEXITCODE -ne 0) { throw 'git push of the tag failed' }
$functionsTag = ''
if ($deploy -and $deploy.headSha -and $deploy.headSha -ne $sha) {
  $functionsTag = "$tag-functions"
  git tag -a $functionsTag $deploy.headSha -m "Last successfully deployed Functions before $Task"
  if ($LASTEXITCODE -ne 0) { throw 'git tag (functions) failed' }
  git push -q origin $functionsTag
  if ($LASTEXITCODE -ne 0) { throw 'git push of the functions tag failed' }
}

$dir = Join-Path $env:USERPROFILE ("AccazaRestorePoints\" + ($tag -replace '/', '_'))
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$snapshots = @()
foreach ($n in $Nodes) {
  $clean = $n.Trim('/')
  $fileName = $clean + '.json'
  $file = Join-Path $dir $fileName
  # The Firebase CLI's project lookup fails intermittently ("Failed to get details for project"); retry briefly.
  $ok = $false
  for ($attempt = 1; $attempt -le 3 -and -not $ok; $attempt++) {
    firebase database:get "/$clean" --project $Project -o $file
    if ($LASTEXITCODE -eq 0) { $ok = $true } else { Start-Sleep -Seconds (5 * $attempt) }
  }
  if (-not $ok) { throw "Snapshot of /$clean failed after 3 attempts. If the error was 403 / 'Failed to get details for project', the Firebase CLI is using a different Google account in this folder: run from the main project folder, or 'firebase login:use <your account>' here." }
  $text = [IO.File]::ReadAllText($file).Trim()
  # A missing node comes back as null. Restoring a null would DELETE the live node, so it is refused here.
  if (-not $text -or $text -eq 'null' -or $text -eq '{}') { throw "Snapshot of /$clean is empty or null in $Project. Refusing to record a restore point that could delete live data." }
  $bytes = (Get-Item $file).Length
  if ($bytes -gt $MaxBytes) { throw "Snapshot of /$clean is $bytes bytes (> $MaxBytes). Restore points hold small settings nodes only." }
  $snapshots += [ordered]@{ node = $clean; fileName = $fileName; bytes = $bytes; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash }
}

$manifest = [ordered]@{
  tag = $tag; functionsTag = $functionsTag; mainSha = $sha; project = $Project; takenAt = (Get-Date).ToString('o')
  lastSuccessfulFunctionsDeploy = $deploy
  dailyDatabaseBackup = "gs://$Project-default-rtdb-backups (automated daily, 30-day lifecycle; not downloaded)"
  nodes = $snapshots
  restoreOrder = @(
    '1. Switch off: set the task feature flag back to off (if it has one).',
    "2. Code: revert the merge commit on main (gh pr revert / git revert) so Pages and Functions redeploy. Tags: $tag $functionsTag",
    '3. Data: .\tools\restore-point\restore-node.ps1 -Manifest <this file> -Node <one node> -Project <same project>  (one small node only).',
    'NEVER import a whole-database backup over live data: it erases every sale, shift, Z report and payment since.'
  )
}
$manifestFile = Join-Path $dir 'manifest.json'
Write-NoBom $manifestFile ($manifest | ConvertTo-Json -Depth 6)
Write-Output "Restore point ready: $tag"
Write-Output "Manifest: $manifestFile"
$manifest.restoreOrder | ForEach-Object { Write-Output $_ }
