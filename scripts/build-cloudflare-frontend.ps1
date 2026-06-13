$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$output = Join-Path $root "cloudflare-public"

if (Test-Path -LiteralPath $output) {
  Remove-Item -LiteralPath $output -Recurse -Force
}

New-Item -ItemType Directory -Path $output | Out-Null
Copy-Item -LiteralPath (Join-Path $root "index.html") -Destination $output
Copy-Item -LiteralPath (Join-Path $root "app.js") -Destination $output
Copy-Item -LiteralPath (Join-Path $root "recruitment-pdf.js") -Destination $output
Copy-Item -LiteralPath (Join-Path $root "styles.css") -Destination $output
Copy-Item -LiteralPath (Join-Path $root "config.example.js") -Destination $output
Copy-Item -LiteralPath (Join-Path $root "assets") -Destination $output -Recurse

Write-Host "Cloudflare frontend prepared at $output"
