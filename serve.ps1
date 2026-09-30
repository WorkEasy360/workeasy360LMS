# Zero-dependency static dev server (no Node/Python required).  Usage:  powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 5173]
param([int]$Port = 5173)
$root = $PSScriptRoot
$mime = @{ ".html"="text/html; charset=utf-8"; ".js"="text/javascript; charset=utf-8"; ".mjs"="text/javascript; charset=utf-8"; ".css"="text/css; charset=utf-8";
  ".json"="application/json"; ".svg"="image/svg+xml"; ".png"="image/png"; ".jpg"="image/jpeg"; ".ico"="image/x-icon"; ".woff2"="font/woff2"; ".txt"="text/plain" }
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() } catch { Write-Host "Could not start on port $Port : $($_.Exception.Message)"; exit 1 }
Write-Host "WorkEasy360LMS running at http://localhost:$Port/   (Ctrl+C to stop)"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($ctx.Request.HttpMethod -eq "POST" -and $path -eq "/__log") {
      # dev-only: lets in-browser self-tests stream results to tests/last-run.log
      $sr = New-Object IO.StreamReader($ctx.Request.InputStream); $line = $sr.ReadToEnd(); $sr.Close()
      Add-Content -Path (Join-Path $root "tests\last-run.log") -Value $line -Encoding UTF8
      $ctx.Response.StatusCode = 204; continue
    }
    if ($path -eq "/") { $path = "/index.html" }
    $file = [IO.Path]::GetFullPath((Join-Path $root $path.TrimStart("/")))
    if (-not $file.StartsWith($root) -or -not (Test-Path $file -PathType Leaf)) { $ctx.Response.StatusCode = 404; $bytes = [Text.Encoding]::UTF8.GetBytes("Not found") }
    else {
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $ctx.Response.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
      $ctx.Response.Headers.Add("Cache-Control", "no-store")
      $bytes = [IO.File]::ReadAllBytes($file)
    }
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch { } finally { $ctx.Response.Close() }
}
