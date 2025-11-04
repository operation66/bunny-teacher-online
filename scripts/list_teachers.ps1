Param(
  [string]$BaseUrl = "http://localhost:8000",
  [int]$BunnyLibraryId
)

try {
  $teachers = Invoke-RestMethod -Uri "$BaseUrl/teachers/" -Method Get
  if ($PSBoundParameters.ContainsKey('BunnyLibraryId')) {
    $teachers = $teachers | Where-Object { $_.bunny_library_id -eq $BunnyLibraryId }
  }
  $teachers | ConvertTo-Json -Depth 6
} catch {
  Write-Error $_
  exit 1
}