param(
  [string]$AppRoot = (Split-Path -Parent $PSScriptRoot)
)

Add-Type -AssemblyName System.Drawing

$assets = Join-Path $AppRoot 'assets'
$iconSource = Join-Path $assets 'app-icon-source.png'
$splashSource = Join-Path $assets 'splash-screen.jpeg'

function New-ContainedImage {
  param(
    [string]$Source,
    [string]$Destination,
    [int]$Width,
    [int]$Height,
    [System.Drawing.Color]$Background,
    [double]$Scale = 1.0
  )

  $sourceImage = [System.Drawing.Image]::FromFile($Source)
  $bitmap = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear($Background)
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $availableWidth = [Math]::Floor($Width * $Scale)
    $availableHeight = [Math]::Floor($Height * $Scale)
    $ratio = [Math]::Min($availableWidth / $sourceImage.Width, $availableHeight / $sourceImage.Height)
    $drawWidth = [Math]::Max(1, [Math]::Round($sourceImage.Width * $ratio))
    $drawHeight = [Math]::Max(1, [Math]::Round($sourceImage.Height * $ratio))
    $left = [Math]::Floor(($Width - $drawWidth) / 2)
    $top = [Math]::Floor(($Height - $drawHeight) / 2)
    $graphics.DrawImage($sourceImage, $left, $top, $drawWidth, $drawHeight)
    $bitmap.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
    $sourceImage.Dispose()
  }
}

$iconBackground = [System.Drawing.Color]::FromArgb(255, 4, 47, 75)
$splashBackground = [System.Drawing.Color]::FromArgb(255, 238, 239, 237)

New-ContainedImage $iconSource (Join-Path $assets 'pwa-icon-192.png') 192 192 $iconBackground 1.0
New-ContainedImage $iconSource (Join-Path $assets 'pwa-icon-512.png') 512 512 $iconBackground 1.0
New-ContainedImage $iconSource (Join-Path $assets 'pwa-maskable-512.png') 512 512 $iconBackground 0.78
New-ContainedImage $iconSource (Join-Path $assets 'apple-touch-icon.png') 180 180 $iconBackground 0.92

New-ContainedImage $splashSource (Join-Path $assets 'splash-1170x2532.png') 1170 2532 $splashBackground 0.82
New-ContainedImage $splashSource (Join-Path $assets 'splash-1290x2796.png') 1290 2796 $splashBackground 0.82
New-ContainedImage $splashSource (Join-Path $assets 'splash-2048x2732.png') 2048 2732 $splashBackground 0.82

Write-Output "Generated PWA assets in $assets"
