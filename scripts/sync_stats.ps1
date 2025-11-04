Param(
  [int[]]$LibraryIds = @(315308),
  [int]$Month = 9,
  [int]$Year = 2025,
  [string]$BaseUrl = "http://localhost:8000"
)

$body = [ordered]@{ library_ids = $LibraryIds; month = $Month; year = $Year }
$json = $body | ConvertTo-Json -Compress

Write-Host "Posting sync to $BaseUrl/historical-stats/sync/ with:" -ForegroundColor Cyan
Write-Host $json

try {
  $response = Invoke-RestMethod -Uri "$BaseUrl/historical-stats/sync/" -Method Post -ContentType "application/json" -Body $json
  $response | ConvertTo-Json -Depth 8
} catch {
  Write-Error $_
  exit 1
}