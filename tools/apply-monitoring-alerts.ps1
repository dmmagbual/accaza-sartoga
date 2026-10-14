# Creates or updates the owner alert policies in ops/monitoring/alert-policies.json
# on Google Cloud Monitoring (project accaza-sartoga). Safe to re-run: a policy is
# matched by display name and updated in place, never duplicated.
# Every notification channel whose display name starts with "Danilo" is attached,
# so phone numbers stay in Google Cloud and out of this public repository.
# Requires: gcloud signed in as a project owner. Reads Cloud Logging only at alert time:
# no Firebase reads, downloads or function calls.
param([string]$Project = "accaza-sartoga", [switch]$DryRun)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$spec = Get-Content -Raw -Path (Join-Path $root "ops/monitoring/alert-policies.json") | ConvertFrom-Json
$token = (gcloud auth print-access-token).Trim()
if (-not $token) { throw "gcloud is not signed in" }
$h = @{Authorization = "Bearer $token"}
$api = "https://monitoring.googleapis.com/v3/projects/$Project"
$channels = @((Invoke-RestMethod -Headers $h -Uri "$api/notificationChannels").notificationChannels |
  Where-Object { $_.displayName -like "Danilo*" -and $_.enabled -ne $false })
if (-not $channels.Count) { throw "No 'Danilo*' notification channel exists" }
$channels | ForEach-Object { Write-Output ("channel {0} {1} {2}" -f $_.type, $_.displayName, $_.verificationStatus) }
$existing = @{}
$page = $null
do {
  $uri = "$api/alertPolicies?pageSize=100" + $(if ($page) { "&pageToken=$page" } else { "" })
  $r = Invoke-RestMethod -Headers $h -Uri $uri
  foreach ($p in @($r.alertPolicies)) { if ($p) { $existing[$p.displayName] = $p } }
  $page = $r.nextPageToken
} while ($page)
foreach ($def in $spec.policies) {
  $extract = @{}; $def.labelExtractors.PSObject.Properties | ForEach-Object { $extract[$_.Name] = $_.Value }
  $body = [ordered]@{
    displayName = $def.displayName; severity = $def.severity; combiner = "OR"; enabled = $true
    documentation = @{content = $def.doc; mimeType = "text/markdown"; subject = $def.subject}
    conditions = @(@{displayName = "Matching log entry"; conditionMatchedLog = @{filter = $def.filter; labelExtractors = $extract}})
    alertStrategy = @{notificationRateLimit = @{period = $def.rateLimit}; autoClose = "1800s"}
    notificationChannels = @($channels | ForEach-Object { $_.name })
  }
  $json = $body | ConvertTo-Json -Depth 8
  if ($DryRun) { Write-Output "DRY RUN $($def.displayName)"; continue }
  $current = $existing[$def.displayName]
  if ($current) {
    $mask = "displayName,severity,combiner,enabled,documentation,conditions,alertStrategy,notificationChannels"
    $res = Invoke-RestMethod -Method Patch -Headers $h -ContentType "application/json; charset=utf-8" -Uri "https://monitoring.googleapis.com/v3/$($current.name)?updateMask=$mask" -Body ([Text.Encoding]::UTF8.GetBytes($json))
    Write-Output "updated $($res.displayName)"
  } else {
    $res = Invoke-RestMethod -Method Post -Headers $h -ContentType "application/json; charset=utf-8" -Uri "$api/alertPolicies" -Body ([Text.Encoding]::UTF8.GetBytes($json))
    Write-Output "created $($res.displayName)"
  }
}
