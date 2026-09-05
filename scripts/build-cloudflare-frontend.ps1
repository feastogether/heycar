$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$output = Join-Path $root "cloudflare-public"

if (Test-Path -LiteralPath $output) {
  Remove-Item -LiteralPath $output -Recurse -Force
}

New-Item -ItemType Directory -Path $output | Out-Null
Copy-Item -LiteralPath (Join-Path $root "index.html") -Destination $output
Copy-Item -LiteralPath (Join-Path $root "app.js") -Destination $output
if (Test-Path -LiteralPath (Join-Path $root "recruitment-pdf.js")) {
  Copy-Item -LiteralPath (Join-Path $root "recruitment-pdf.js") -Destination $output
}
Copy-Item -LiteralPath (Join-Path $root "styles.css") -Destination $output
Copy-Item -LiteralPath (Join-Path $root "config.js") -Destination $output
Copy-Item -LiteralPath (Join-Path $root "config.example.js") -Destination $output
Copy-Item -LiteralPath (Join-Path $root "assets") -Destination $output -Recurse

$_headers = @"
/*
  Cache-Control: no-store, no-cache, must-revalidate, max-age=0
  Pragma: no-cache
  Expires: 0
"@
[System.IO.File]::WriteAllText((Join-Path $output "_headers"), $_headers, [System.Text.UTF8Encoding]::new($false))

Write-Host "Cloudflare frontend prepared at $output"
