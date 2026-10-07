<#
  Accaza single-node restore (Purchases & Payments Consolidation Plan, gate R0, layer c).
  Restores ONE small settings node from a restore point taken by take.ps1, into the SAME project.
  Refuses: the database root, transaction nodes, number counters, nodes not in the restore point,
  a snapshot whose sha256 changed, an empty/null snapshot (that would delete the node), and -- for
  booksChart / cfAccounts -- removing keys added since the snapshot unless -AllowRemove is given.
  It saves the live node first (so the restore itself can be undone), asks you to type the node
  path back, and writes an operationalAudit "intent" row before and a "done" row after.

  Usage:  .\tools\restore-point\restore-node.ps1 -Manifest "$env:USERPROFILE\AccazaRestorePoints\<tag>\manifest.json" -Node config -Project accaza-sartoga
  Practise on UAT: take a restore point with -Project accazacoffeepos-uat and restore it there.
  A production snapshot may be restored into UAT only with -ToUat.
#>
param(
  [Parameter(Mandatory = $true)][string]$Manifest,
  [Parameter(Mandatory = $true)][string]$Node,
  [Parameter(Mandatory = $true)][ValidateSet('accaza-sartoga', 'accazacoffeepos-uat')][string]$Project,
  [switch]$AllowRemove,
  [switch]$ToUat
)
$ErrorActionPreference = 'Stop'
function Write-NoBom([string]$Path, [string]$Text) { [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false)) }
$clean = $Node.Trim().Trim('/')
if (-not $clean) { throw 'Refusing to restore the database root. Restore one small node only.' }
$Forbidden = @('orders', 'archivedOrders', 'shifts', 'financialMovements', 'payables', 'purchaseInvoices', 'pettyCashVouchers', 'cashCustody', 'books', 'inventory', 'inventoryMovements', 'stockReceipts', 'cfLedger', 'operationalAudit')
if ($Forbidden -contains $clean.Split('/')[0]) { throw "Refusing to restore '$clean': transaction data is corrected with reversing entries, never overwritten." }
# Number counters are captured as evidence only. Restoring one backwards would re-issue PUR / PV /
# document numbers that are already printed and posted, so it is never allowed.
$ReferenceOnly = @('documentCounters', 'pettyCashCounter')
if ($ReferenceOnly -contains $clean.Split('/')[0]) { throw "Refusing to restore '$clean': number counters only move forward. Restoring one would re-issue numbers already used." }

$manifestDir = Split-Path -Parent (Resolve-Path -LiteralPath $Manifest)
$m = Get-Content -Raw -LiteralPath $Manifest | ConvertFrom-Json
if ($Project -cne $m.project -and -not ($ToUat -and $Project -ceq 'accazacoffeepos-uat')) { throw "This restore point was taken from '$($m.project)'. Restoring it into '$Project' is refused (use -ToUat only to copy a production snapshot into UAT)." }
$entry = $m.nodes | Where-Object { $_.node -ceq $clean } | Select-Object -First 1
if (-not $entry) { throw "Node '$clean' is not in this restore point (names are case-sensitive). Captured nodes: $(($m.nodes | ForEach-Object { $_.node }) -join ', ')" }
$target = $entry.node
$file = Join-Path $manifestDir $entry.fileName
if (-not (Test-Path -LiteralPath $file)) { throw "Snapshot file missing: $file" }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash -cne $entry.sha256) { throw "Snapshot $file changed since the restore point was taken (sha256 mismatch). Refusing." }
$snapText = [IO.File]::ReadAllText($file).Trim()
if (-not $snapText -or $snapText -eq 'null' -or $snapText -eq '{}') { throw 'The snapshot is empty or null; restoring it would delete the live node. Refusing.' }
$snap = $snapText | ConvertFrom-Json

# Save the live node first, so this restore can itself be undone.
$ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$preFile = Join-Path $manifestDir "pre-restore-$target-$ms.json"
firebase database:get "/$target" --project $Project -o $preFile
if ($LASTEXITCODE -ne 0) { throw "Could not save the live /$target before restoring. Nothing was changed." }
$liveText = [IO.File]::ReadAllText($preFile).Trim()
$liveKeys = @(); if ($liveText -and $liveText -ne 'null') { $liveKeys = @(($liveText | ConvertFrom-Json).PSObject.Properties.Name) }
$snapKeys = @($snap.PSObject.Properties.Name)
$removed = @($liveKeys | Where-Object { $snapKeys -cnotcontains $_ })
$added = @($snapKeys | Where-Object { $liveKeys -cnotcontains $_ })
$ageHours = [Math]::Round(((Get-Date) - [DateTime]$m.takenAt).TotalHours, 1)
Write-Output "Restore point : $($m.tag) (taken $($m.takenAt), $ageHours h ago)"
Write-Output "Project       : $Project"
Write-Output "Node          : /$target  <-  $file"
Write-Output "Live saved to : $preFile"
Write-Output "Keys removed by this restore: $(if ($removed.Count) { $removed -join ', ' } else { 'none' })"
Write-Output "Keys added by this restore  : $(if ($added.Count) { $added -join ', ' } else { 'none' })"
if ($removed.Count -and @('booksChart', 'cfAccounts') -ccontains $target -and -not $AllowRemove) { throw "Refusing: the restore would remove $($removed.Count) key(s) created since the snapshot (postings may reference them). Re-run with -AllowRemove only after checking each one." }

$typed = Read-Host "Type the node path exactly to overwrite /$target in $Project"
if ($typed.Trim().Trim('/') -cne $target) { throw 'Confirmation did not match. Nothing was changed.' }

$account = ''
$login = (firebase login:list 2>$null) | Select-String -Pattern 'Logged in as (\S+)' | Select-Object -First 1
if ($login) { $account = $login.Matches[0].Groups[1].Value }
$audit = [ordered]@{ action = 'restore_node_from_restore_point'; stage = 'intent'; node = $target; project = $Project; restorePoint = $m.tag; mainSha = $m.mainSha; snapshotSha256 = $entry.sha256; preRestoreFile = $preFile; keysRemoved = $removed; keysAdded = $added; firebaseAccount = $account; windowsUser = $env:USERNAME; ts = $ms; schemaVersion = 2 }
$intentFile = Join-Path $manifestDir "audit-intent-$ms.json"
Write-NoBom $intentFile ($audit | ConvertTo-Json -Compress -Depth 4)
firebase database:set "/operationalAudit/${ms}_restore_node_intent" $intentFile --project $Project --force
if ($LASTEXITCODE -ne 0) { throw 'Could not write the audit intent row. Nothing was restored.' }

firebase database:set "/$target" $file --project $Project --force
if ($LASTEXITCODE -ne 0) { throw "Restore of /$target failed. The audit intent row exists; the live node was saved to $preFile." }

$audit.stage = 'done'; $audit.ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$doneFile = Join-Path $manifestDir "audit-done-$ms.json"
Write-NoBom $doneFile ($audit | ConvertTo-Json -Compress -Depth 4)
firebase database:set "/operationalAudit/${ms}_restore_node_done" $doneFile --project $Project --force
if ($LASTEXITCODE -ne 0) { throw "Restored /$target, but the audit 'done' row failed. Record it manually (intent row ${ms}_restore_node_intent exists)." }
Write-Output "Restored /$target in $Project. Audit: operationalAudit/${ms}_restore_node_intent and _done. Undo file: $preFile"
