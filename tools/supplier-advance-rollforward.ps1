<#
  Supplier Advances (1115) roll-forward — READ-ONLY diagnostic fetch + run.

  Purpose: the Cash Flow control audit reports account 1115 as one net line
  ("Finance Books -5637.50 vs open subledger 0.00"). This script downloads only the evidence
  that audit itself uses, then runs tools/supplier-advance-rollforward.mjs to name each
  advance, its Finance Books debit/credit, its open subledger amount and a verdict.

  It NEVER writes to the database: every call is `firebase database:get`. It does not post,
  repair, allocate, void or journal anything. Corrections happen afterwards in the owning
  workflow (Admin > Cash Payments, Admin > Purchases, Admin > Discrepancies). Account 1115
  refuses manual journals by design.

  Firebase reads (cost — this is a manual diagnostic, run it when an exception needs naming):
    /financialMovements                          full node  (download-ok: manual 1115 roll-forward)
    /pettyCashVouchers?transactionType=purchase_advance  indexed, bounded query
    /supplierAdvanceShifts                       small index
    /cashDifferencePurchaseAdvances              small, function-written
    /purchaseInvoices                            moderate, labels the allocations
    /shifts/<id>/payOuts                         one small read per indexed shift
  With -AllShifts it also reads the shift key list shallow and then one payOuts read per shift,
  which is how you check the advance index for staleness. Use it only when you suspect the index.

  Output goes OUTSIDE the repository: %USERPROFILE%\AccazaDiagnostics\supplier-advance-<stamp>\
  Usage:  .\tools\supplier-advance-rollforward.ps1
          .\tools\supplier-advance-rollforward.ps1 -AllShifts
#>
param(
  [ValidateSet('accaza-sartoga', 'accazacoffeepos-uat')][string]$Project = 'accaza-sartoga',
  [string]$OutDir = '',
  [switch]$AllShifts
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not (Test-Path -LiteralPath (Join-Path $repo 'tools\supplier-advance-rollforward.mjs'))) { throw "Run this from the project folder; tools\supplier-advance-rollforward.mjs was not found under $repo." }
$tool = Join-Path $repo 'tools\supplier-advance-rollforward.mjs'
if (-not $OutDir) { $OutDir = Join-Path $env:USERPROFILE ('AccazaDiagnostics\supplier-advance-' + (Get-Date -Format 'yyyyMMdd-HHmm')) }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
function Write-NoBom([string]$Path, [string]$Text) { [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false)) }

# The Firebase CLI's project lookup fails intermittently. Retry briefly, exactly like the restore-point tool.
function Get-Node([string]$Path, [string]$FileName, [string[]]$Query = @()) {
  $file = Join-Path $OutDir $FileName
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $cliArgs = @('database:get', $Path, '--project', $Project, '-o', $file) + $Query
    & firebase @cliArgs
    if ($LASTEXITCODE -eq 0) { return $file }
    Start-Sleep -Seconds (4 * $attempt)
  }
  throw "Read of $Path failed after 3 attempts. If the error was 403 / 'Failed to get details for project', the Firebase CLI is signed in with a different Google account in this folder: run 'firebase login:use <your account>' here."
}
function Read-Json([string]$File, $Fallback) {
  if (-not (Test-Path -LiteralPath $File)) { return $Fallback }
  $raw = ([IO.File]::ReadAllText($File)).Trim()
  if (-not $raw -or $raw -eq 'null') { return $Fallback }
  return ($raw | ConvertFrom-Json)
}

Write-Output "Project: $Project"
Write-Output "Output : $OutDir"
Write-Output 'Reading financialMovements (full node)…'
Get-Node '/financialMovements' 'financialMovements.json' | Out-Null
Write-Output 'Reading purchase_advance vouchers (indexed query)…'
Get-Node '/pettyCashVouchers' 'pettyCashVouchers.json' @('--order-by', 'transactionType', '--equal-to', 'purchase_advance') | Out-Null
Write-Output 'Reading supplier advance index and cash-difference advances…'
Get-Node '/supplierAdvanceShifts' 'supplierAdvanceShifts.json' | Out-Null
Get-Node '/cashDifferencePurchaseAdvances' 'cashDifferencePurchaseAdvances.json' | Out-Null
Get-Node '/purchaseInvoices' 'purchaseInvoices.json' | Out-Null

# Register shift pay-outs. Only the indexed shifts are part of the audit's subledger total.
$shiftIds = @()
if ($AllShifts) {
  Write-Output 'WARNING: -AllShifts reads every shift payOuts node. Use it only to test the advance index for staleness.'
  Get-Node '/shifts' 'shifts-keys.json' @('--shallow') | Out-Null
  $keys = Read-Json (Join-Path $OutDir 'shifts-keys.json') $null
  if ($keys) { $shiftIds = @($keys.PSObject.Properties.Name) }
} else {
  $index = Read-Json (Join-Path $OutDir 'supplierAdvanceShifts.json') $null
  if ($index) { $shiftIds = @($index.PSObject.Properties.Name) }
}
Write-Output "Shifts holding a supplier advance: $($shiftIds.Count)"
$shiftsOut = [ordered]@{}
foreach ($id in $shiftIds) {
  $safe = ($id -replace '[^A-Za-z0-9._-]', '_')
  $file = Get-Node "/shifts/$id/payOuts" ("payOuts-" + $safe + '.json')
  $shiftsOut[$id] = @{ payOuts = (Read-Json $file @()) }
}
$shiftsJson = $shiftsOut | ConvertTo-Json -Depth 12 -Compress
if (-not $shiftsJson) { $shiftsJson = '{}' }
Write-NoBom (Join-Path $OutDir 'shifts.json') $shiftsJson

Write-Output ''
& node $tool "$OutDir"
Write-Output ''
Write-Output "Files kept in: $OutDir"
Write-Output 'Read-only: nothing was posted, changed or repaired. Correct the named advances in Admin > Cash Payments / Purchases, then run the control audit again.'
