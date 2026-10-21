<#
  Deploys the current working tree to the Accaza UAT Firebase project ONLY.
  The production project is never a target: the UAT project is pinned and checked,
  and every firebase command passes --project explicitly.

  Usage (from the project folder):
    powershell -ExecutionPolicy Bypass -File tools\uat\deploy-uat.ps1
    powershell -ExecutionPolicy Bypass -File tools\uat\deploy-uat.ps1 -SkipFunctions   # rules + site only

  What it deploys to UAT:
    - Realtime Database rules, Firestore rules and indexes (same files as production)
    - every Cloud Function EXCEPT the scheduled ones (no Cloud Scheduler jobs, no timer cost)
    - a static copy of admin.html / books.html and their assets to https://accazacoffeepos-uat.web.app
      (whitelist only: never backups, pricing/costing, pictures or video)
  Secrets used by AI / SMS functions get the placeholder "uat-disabled", so UAT can never
  call a paid AI provider or send a real SMS.
#>
[CmdletBinding()]
param(
  [string]$Project = 'accazacoffeepos-uat',
  [switch]$SkipFunctions,
  [switch]$SkipHosting,
  [switch]$PlanOnly,     # build the UAT config and site, print the targets, deploy nothing
  [string[]]$Functions    # deploy only these function names (e.g. to finish a partly failed deploy)
)
# 'Continue', not 'Stop': Windows PowerShell 5.1 turns any stderr text from gcloud/firebase
# (progress, "not found" probes) into a fatal error. Every native step is checked by exit code
# in Invoke-Step instead, and every guard below uses throw.
$ErrorActionPreference = 'Continue'
$UatProject = 'accazacoffeepos-uat'
if ($Project -ne $UatProject) { throw "Refusing to deploy: '$Project' is not the UAT project ($UatProject)." }

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $root

function Invoke-Step([string]$Name, [scriptblock]$Block) {
  Write-Host "==> $Name" -ForegroundColor Cyan
  $global:LASTEXITCODE = 0
  & $Block
  if ($LASTEXITCODE -ne 0) { throw "$Name failed (exit $LASTEXITCODE)" }
}

$configPath = Join-Path $root 'firebase.uat.json'
try {
  Invoke-Step 'Build runtime bundles and pages' { npm run build:artifacts }

  # Function runtime settings for UAT only (git-ignored by .env.*).
  Set-Content -LiteralPath (Join-Path $root "functions\.env.$UatProject") -Encoding ascii -Value @(
    'ENFORCE_APP_CHECK=false',
    'ENFORCE_APP_CHECK_ORDERS=false',
    "PROOF_STORAGE_BUCKET=$UatProject.firebasestorage.app"
  )

  if (-not $SkipFunctions -and -not $PlanOnly) {
    Invoke-Step 'Enable Secret Manager in UAT' { gcloud services enable secretmanager.googleapis.com --project $UatProject --quiet }
    $placeholder = Join-Path $env:TEMP 'accaza-uat-secret.txt'
    [System.IO.File]::WriteAllText($placeholder, 'uat-disabled')
    foreach ($secret in 'CEREBRAS_API_KEY','GEMINI_API_KEY','GROQ_API_KEY','QWEN_API_KEY','SEMAPHORE_API_KEY') {
      $global:LASTEXITCODE = 0
      gcloud secrets describe $secret --project $UatProject *> $null
      if ($LASTEXITCODE -ne 0) {
        Invoke-Step "Create placeholder secret $secret" { gcloud secrets create $secret --project $UatProject --replication-policy=automatic --data-file=$placeholder --quiet }
      }
    }
    Remove-Item -LiteralPath $placeholder -Force -ErrorAction SilentlyContinue
  }

  $targets = @('database', 'firestore:rules', 'firestore:indexes')
  $fnTargets = @()
  if (-not $SkipFunctions) {
    $fnList = (node tools/uat/uat-function-list.mjs)
    if ($LASTEXITCODE -ne 0 -or -not $fnList) { throw 'Could not list functions for UAT.' }
    $fnTargets = $fnList -split ','
    if ($Functions) {
      $wanted = $Functions | ForEach-Object { $_ -split ',' } | Where-Object { $_ } | ForEach-Object { "functions:$($_.Trim())" }
      $unknown = $wanted | Where-Object { $fnTargets -notcontains $_ }
      if ($unknown) { throw "Not deployable to UAT (unknown or scheduled): $($unknown -join ', ')" }
      $fnTargets = $wanted
    }
  }

  $base = Get-Content -LiteralPath (Join-Path $root 'firebase.json') -Raw | ConvertFrom-Json
  if (-not $SkipHosting) {
    $site = Join-Path $root 'dist\uat-site'
    if (Test-Path -LiteralPath $site) { Remove-Item -LiteralPath $site -Recurse -Force }
    New-Item -ErrorAction Stop -ItemType Directory -Path $site | Out-Null
    $files = @('admin.html','books.html','styles.css','sw.js','manifest-admin.json','manifest.json','build-version.json','favicon.ico','favicon.svg','favicon_180x180.png','favicon_192x192.png','favicon_32x32.png','favicon_512x512.png')
    foreach ($f in $files) { if (Test-Path -LiteralPath (Join-Path $root $f)) { Copy-Item -ErrorAction Stop -LiteralPath (Join-Path $root $f) -Destination $site } }
    Copy-Item -ErrorAction Stop -LiteralPath (Join-Path $root 'assets') -Destination $site -Recurse
    New-Item -ErrorAction Stop -ItemType Directory -Path (Join-Path $site 'src') | Out-Null
    Copy-Item -ErrorAction Stop -LiteralPath (Join-Path $root 'src\books') -Destination (Join-Path $site 'src') -Recurse
    Set-Content -LiteralPath (Join-Path $site 'robots.txt') -Encoding ascii -Value @('User-agent: *','Disallow: /')
    Set-Content -LiteralPath (Join-Path $site 'index.html') -Encoding ascii -Value '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Accaza UAT</title><p>Accaza UAT test environment. <a href="admin.html">Admin</a> &middot; <a href="books.html">Finance Books</a></p>'
    $base | Add-Member -NotePropertyName hosting -NotePropertyValue ([ordered]@{
      public = 'dist/uat-site'
      headers = @(@{ source = '**'; headers = @(@{ key = 'X-Robots-Tag'; value = 'noindex, nofollow' }) })
    }) -Force
    $targets += 'hosting'
  }
  # UTF-8 without BOM: the Firebase CLI's JSON reader rejects a BOM.
  [System.IO.File]::WriteAllText($configPath, ($base | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding $false))
  if ($PlanOnly) {
    Write-Host ('Targets: ' + ($targets.Count + $fnTargets.Count) + ' (' + $targets.Count + ' rules/site + ' + $fnTargets.Count + ' functions in batches of 25)')
    node -e "const c=require('./firebase.uat.json');console.log('config ok: hosting.public='+(c.hosting&&c.hosting.public)+' functions.source='+c.functions[0].source)"
    if ($LASTEXITCODE -ne 0) { throw 'Generated firebase.uat.json is not valid.' }
    return
  }

  Invoke-Step 'Deploy rules and site to UAT' { firebase deploy --config firebase.uat.json --project $UatProject --only ($targets -join ',') --non-interactive --force }
  # Functions go in batches: a new project allows only a limited number of function
  # create/update calls per minute, and a single 150-function deploy hits that limit (HTTP 429).
  # Each batch is retried once after a pause; first-time Eventarc permission delays also clear.
  for ($i = 0; $i -lt $fnTargets.Count; $i += 25) {
    $batch = $fnTargets[$i..([Math]::Min($i + 24, $fnTargets.Count - 1))] -join ','
    $label = "Deploy functions $($i + 1)-$([Math]::Min($i + 25, $fnTargets.Count)) of $($fnTargets.Count)"
    Write-Host "==> $label" -ForegroundColor Cyan
    $global:LASTEXITCODE = 0
    firebase deploy --config firebase.uat.json --project $UatProject --only $batch --non-interactive --force
    if ($LASTEXITCODE -ne 0) {
      Write-Host "    retrying once after 90 s" -ForegroundColor Yellow
      Start-Sleep -Seconds 90
      Invoke-Step "$label (retry)" { firebase deploy --config firebase.uat.json --project $UatProject --only $batch --non-interactive --force }
    }
    if ($i + 25 -lt $fnTargets.Count) { Start-Sleep -Seconds 60 }
  }
  Write-Host "UAT deployed: https://$UatProject.web.app/admin.html" -ForegroundColor Green
}
finally {
  Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
}
