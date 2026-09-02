param(
  [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"
if (-not $ProjectRoot) {
  $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeIconHandle {
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern bool DestroyIcon(IntPtr handle);
}
"@

$assetRoot = Join-Path $ProjectRoot "assets\branding"
$clientAssetRoot = Join-Path $ProjectRoot "client\AIStephVoice\Assets"
New-Item -ItemType Directory -Force -Path $assetRoot, $clientAssetRoot | Out-Null
$pngPath = Join-Path $assetRoot "aisteph-voice-icon.png"
$icoPath = Join-Path $clientAssetRoot "AIStephVoice.ico"

$bitmap = New-Object System.Drawing.Bitmap 256, 256, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#2E9B64"))
  $font = New-Object System.Drawing.Font "Segoe UI", 166, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $format = New-Object System.Drawing.StringFormat
  try {
    $format.Alignment = [System.Drawing.StringAlignment]::Far
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $graphics.DrawString("S", $font, $brush, (New-Object System.Drawing.RectangleF 0, 0, 234, 250), $format)
    $bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $iconHandle = $bitmap.GetHicon()
    try {
      $icon = [System.Drawing.Icon]::FromHandle($iconHandle)
      $stream = [System.IO.File]::Create($icoPath)
      try { $icon.Save($stream) } finally { $stream.Dispose(); $icon.Dispose() }
    } finally {
      [NativeIconHandle]::DestroyIcon($iconHandle) | Out-Null
    }
  } finally {
    $format.Dispose(); $brush.Dispose(); $font.Dispose()
  }
} finally {
  $graphics.Dispose(); $bitmap.Dispose()
}
Copy-Item -LiteralPath $pngPath -Destination (Join-Path $clientAssetRoot "AIStephVoice.png") -Force
Write-Output $icoPath