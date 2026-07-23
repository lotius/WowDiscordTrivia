# Renders the Discord activity cover art. Uses GDI+ rather than the hand-rolled
# encoder in make-icon.mjs because this artwork needs real font rendering.
#
#   powershell -ExecutionPolicy Bypass -File scripts/make-cover.ps1
#
# Change $Title/$Subtitle to match the application name shown in Discord.

param(
  [string]$Title = "WoWTrivia",
  [string]$Subtitle = "Party trivia for your voice channel"
)

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"
$outDir = Join-Path (Split-Path $PSScriptRoot -Parent) "assets"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# Palette lifted from src/styles.css so the art matches the game itself.
$goldLight  = [System.Drawing.Color]::FromArgb(255, 255, 231, 158)
$goldDark   = [System.Drawing.Color]::FromArgb(255, 201, 138, 47)
$brownDeep  = [System.Drawing.Color]::FromArgb(255, 58, 28, 18)
$brownMid   = [System.Drawing.Color]::FromArgb(255, 125, 66, 36)
$nightTop   = [System.Drawing.Color]::FromArgb(255, 18, 42, 68)
$nightLow   = [System.Drawing.Color]::FromArgb(255, 10, 20, 34)
$parchment  = [System.Drawing.Color]::FromArgb(255, 255, 243, 197)

function New-Cover {
  param([int]$Width, [int]$Height, [string]$Path, [bool]$WithText = $true)

  $bmp = New-Object System.Drawing.Bitmap($Width, $Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  # Night-sky backdrop.
  $rect = New-Object System.Drawing.Rectangle(0, 0, $Width, $Height)
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $nightTop, $nightLow, 60.0)
  $g.FillRectangle($bg, $rect)

  # Sparse starfield. Seeded so repeat runs produce identical art.
  $random = New-Object System.Random(20260722)
  $starBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(90, 255, 255, 255))
  for ($i = 0; $i -lt [int]($Width * $Height / 5500); $i++) {
    $sx = $random.Next(0, $Width)
    $sy = $random.Next(0, $Height)
    $size = $random.Next(2, 5)
    $g.FillEllipse($starBrush, $sx, $sy, $size, $size)
  }

  # Warm glow behind the medallion.
  $medallion = [Math]::Min($Width, $Height) * 0.52
  $cx = if ($WithText) { $Width * 0.24 } else { $Width * 0.5 }
  $cy = $Height * 0.5
  $glowRect = New-Object System.Drawing.Rectangle(
    [int]($cx - $medallion), [int]($cy - $medallion),
    [int]($medallion * 2), [int]($medallion * 2))
  $glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $glowPath.AddEllipse($glowRect)
  $glow = New-Object System.Drawing.Drawing2D.PathGradientBrush($glowPath)
  $glow.CenterColor = [System.Drawing.Color]::FromArgb(120, 214, 149, 69)
  $glow.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 214, 149, 69))
  $g.FillEllipse($glow, $glowRect)

  # Medallion: gold rim, dark face.
  $outer = $medallion * 0.72
  $outerRect = New-Object System.Drawing.Rectangle(
    [int]($cx - $outer), [int]($cy - $outer), [int]($outer * 2), [int]($outer * 2))
  $rim = New-Object System.Drawing.Drawing2D.LinearGradientBrush($outerRect, $goldLight, $goldDark, 45.0)
  $g.FillEllipse($rim, $outerRect)

  $inner = $outer * 0.815
  $innerRect = New-Object System.Drawing.Rectangle(
    [int]($cx - $inner), [int]($cy - $inner), [int]($inner * 2), [int]($inner * 2))
  $face = New-Object System.Drawing.Drawing2D.LinearGradientBrush($innerRect, $brownMid, $brownDeep, 45.0)
  $g.FillEllipse($face, $innerRect)

  # Two stacked chevrons, matching assets/icon.png.
  function Add-Chevron {
    param($Graphics, [double]$CenterX, [double]$TopY, [double]$BottomY,
          [double]$HalfWidth, [double]$Thickness, $Colour)
    $brush = New-Object System.Drawing.SolidBrush($Colour)
    $left = @(
      (New-Object System.Drawing.PointF([float]$CenterX, [float]$TopY)),
      (New-Object System.Drawing.PointF([float]($CenterX + $Thickness * 0.5), [float]$TopY)),
      (New-Object System.Drawing.PointF([float]($CenterX - $HalfWidth + $Thickness), [float]$BottomY)),
      (New-Object System.Drawing.PointF([float]($CenterX - $HalfWidth), [float]$BottomY))
    )
    $right = @(
      (New-Object System.Drawing.PointF([float]$CenterX, [float]$TopY)),
      (New-Object System.Drawing.PointF([float]($CenterX - $Thickness * 0.5), [float]$TopY)),
      (New-Object System.Drawing.PointF([float]($CenterX + $HalfWidth - $Thickness), [float]$BottomY)),
      (New-Object System.Drawing.PointF([float]($CenterX + $HalfWidth), [float]$BottomY))
    )
    $Graphics.FillPolygon($brush, $left)
    $Graphics.FillPolygon($brush, $right)
    $brush.Dispose()
  }

  $span = $inner * 1.02
  Add-Chevron $g $cx ($cy - $span * 0.52) ($cy - $span * 0.04) ($span * 0.52) ($span * 0.185) $parchment
  Add-Chevron $g $cx ($cy - $span * 0.06) ($cy + $span * 0.56) ($span * 0.52) ($span * 0.185) $goldLight

  if ($WithText) {
    $textLeft = $Width * 0.46
    $titleSize = [single]($Height * 0.135)
    $subSize = [single]($Height * 0.042)
    $titleFont = New-Object System.Drawing.Font("Georgia", $titleSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $subFont = New-Object System.Drawing.Font("Segoe UI", $subSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

    $shadow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(200, 12, 8, 6))
    $titleBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
      (New-Object System.Drawing.Rectangle([int]$textLeft, [int]($Height * 0.34), [int]($Width * 0.5), [int]$titleSize)),
      $goldLight, $goldDark, 90.0)
    $subBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(225, 226, 214, 188))

    $titleY = $Height * 0.34
    $offset = $Height * 0.007
    $g.DrawString($Title, $titleFont, $shadow, [float]($textLeft + $offset), [float]($titleY + $offset))
    $g.DrawString($Title, $titleFont, $titleBrush, [float]$textLeft, [float]$titleY)
    $g.DrawString($Subtitle, $subFont, $subBrush, [float]($textLeft + 4), [float]($titleY + $titleSize * 1.15))

    $titleFont.Dispose(); $subFont.Dispose()
    $shadow.Dispose(); $titleBrush.Dispose(); $subBrush.Dispose()
  }

  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  $kb = [int]((Get-Item $Path).Length / 1KB)
  Write-Output ("Wrote {0} ({1}x{2}, {3} KB)" -f $Path, $Width, $Height, $kb)
}

# 1024x576 is the exact size the portal asks for on the Rich Presence invite
# image. The others cover slots that want a larger or square asset.
New-Cover -Width 1024 -Height 576  -Path (Join-Path $outDir "cover-1024x576.png") -WithText $true
New-Cover -Width 1920 -Height 1080 -Path (Join-Path $outDir "cover-wide.png") -WithText $true
New-Cover -Width 1024 -Height 1024 -Path (Join-Path $outDir "cover-square.png") -WithText $false
