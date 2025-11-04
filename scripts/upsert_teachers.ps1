Param(
  [string]$BaseUrl = "http://localhost:8000"
)

function Invoke-UpsertEndpoint {
  param([string]$Url)
  $Headers = @{ 'Content-Type' = 'application/json' }
  try {
    $resp = Invoke-RestMethod -Method POST -Uri $Url -Headers $Headers -TimeoutSec 30
    return $resp
  } catch {
    return $null
  }
}

function Ensure-TeachersFromApis {
  param([string]$BaseUrl)

  $created = 0; $updated = 0; $unchanged = 0; $failed = 0
  $results = @()

  try {
    $configs = @()
    try { $configs = Invoke-RestMethod -Method GET -Uri "$BaseUrl/library-configs/" -TimeoutSec 30 } catch {}
    $configMap = @{}
    foreach ($cfg in $configs) { $configMap[$cfg.library_id] = $cfg.library_name }

    $libraries = Invoke-RestMethod -Method GET -Uri "$BaseUrl/bunny-libraries/" -TimeoutSec 60
    $teachers = Invoke-RestMethod -Method GET -Uri "$BaseUrl/teachers/" -TimeoutSec 60

    $teacherByLib = @{}
    foreach ($t in $teachers) { if ($t.bunny_library_id -ne $null) { $teacherByLib[$t.bunny_library_id] = $t } }

    foreach ($lib in $libraries) {
      $libId = $lib.id
      $libName = $lib.name
      $preferredName = $configMap[$libId]
      if (-not $preferredName -or $preferredName -eq "") { $preferredName = $libName }
      if (-not $preferredName -or $preferredName -eq "") { $preferredName = "Library $libId" }

      if ($teacherByLib.ContainsKey($libId)) {
        $t = $teacherByLib[$libId]
        if ($t.name -ne $preferredName -and $t.id -ne $null) {
          try {
            $body = @{ name = $preferredName; bunny_library_id = $libId } | ConvertTo-Json
            Invoke-RestMethod -Method PUT -Uri "$BaseUrl/teachers/$($t.id)" -Body $body -ContentType 'application/json' -TimeoutSec 30 | Out-Null
            $updated++
            $results += [pscustomobject]@{ bunny_library_id = $libId; name = $preferredName; action = 'updated'; success = $true }
          } catch {
            $failed++
            $results += [pscustomobject]@{ bunny_library_id = $libId; name = $preferredName; action = 'error'; success = $false }
          }
        } else {
          $unchanged++
          $results += [pscustomobject]@{ bunny_library_id = $libId; name = $preferredName; action = 'unchanged'; success = $true }
        }
      } else {
        try {
          $body = @{ name = $preferredName; bunny_library_id = $libId } | ConvertTo-Json
          Invoke-RestMethod -Method POST -Uri "$BaseUrl/teachers/" -Body $body -ContentType 'application/json' -TimeoutSec 30 | Out-Null
          $created++
          $results += [pscustomobject]@{ bunny_library_id = $libId; name = $preferredName; action = 'created'; success = $true }
        } catch {
          $failed++
          $results += [pscustomobject]@{ bunny_library_id = $libId; name = $preferredName; action = 'error'; success = $false }
        }
      }
    }

    return [pscustomobject]@{
      success = $true
      total_libraries = $libraries.Count
      created = $created
      updated = $updated
      unchanged = $unchanged
      failed = $failed
      results = $results
    }
  } catch {
    Write-Error "Fallback upsert failed: $($_.Exception.Message)"
    return $null
  }
}

$UpsertUrl = "$BaseUrl/teachers/upsert-from-bunny/"
$response = Invoke-UpsertEndpoint -Url $UpsertUrl

if ($null -ne $response) {
  Write-Host "Success:" $response.success
  Write-Host "Total libraries:" $response.total_libraries
  Write-Host "Created:" $response.created " Updated:" $response.updated " Unchanged:" $response.unchanged " Failed:" $response.failed
  $response.results | Select-Object bunny_library_id, name, action, success | Format-Table -AutoSize
} else {
  Write-Host "Upsert endpoint unavailable; falling back to client-side upsert using existing APIs..."
  $resp2 = Ensure-TeachersFromApis -BaseUrl $BaseUrl
  if ($null -ne $resp2) {
    Write-Host "Success:" $resp2.success
    Write-Host "Total libraries:" $resp2.total_libraries
    Write-Host "Created:" $resp2.created " Updated:" $resp2.updated " Unchanged:" $resp2.unchanged " Failed:" $resp2.failed
    $resp2.results | Select-Object bunny_library_id, name, action, success | Format-Table -AutoSize
  } else {
    Write-Error "Failed to upsert teachers via both server route and client-side fallback."
    exit 1
  }
}