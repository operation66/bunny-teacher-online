Param(
  [int[]]$LibraryIds = @(315308),
  [int]$Month = 9,
  [int]$Year = 2025,
  [string]$BaseUrl = "http://localhost:8000"
)

$body = [ordered]@{ library_ids = $LibraryIds; month = $Month; year = $Year }
$json = $body | ConvertTo-Json -Compress

Write-Host "Posting batch-fetch to $BaseUrl/historical-stats/batch-fetch/ with:" -ForegroundColor Cyan
Write-Host $json

try {
  $response = Invoke-RestMethod -Uri "$BaseUrl/historical-stats/batch-fetch/" -Method Post -ContentType "application/json" -Body $json
  $response | ConvertTo-Json -Depth 8
} catch {
  Write-Error $_
  exit 1
}