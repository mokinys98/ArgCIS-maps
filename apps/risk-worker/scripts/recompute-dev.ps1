param(
  [string]$Time = "",
  [string]$BaseUrl = "http://127.0.0.1:8787"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Time)) {
  $Time = (Get-Date).ToUniversalTime().ToString("o")
}

$trimmedBaseUrl = $BaseUrl.TrimEnd("/")
$encodedTime = [System.Uri]::EscapeDataString($Time)
$uri = "$trimmedBaseUrl/api/internal/recompute?time=$encodedTime"

Write-Host "POST $uri"

try {
  $response = Invoke-RestMethod -Method Post -Uri $uri
  $response | ConvertTo-Json -Depth 8
} catch {
  $statusCode = $_.Exception.Response.StatusCode.value__
  $message = $_.Exception.Message

  if ($statusCode) {
    Write-Error "Worker recompute call failed with HTTP ${statusCode}: $message"
  } else {
    Write-Error "Worker recompute call failed: $message"
  }

  exit 1
}
