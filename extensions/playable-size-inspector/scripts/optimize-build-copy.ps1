param(
    [Parameter(Mandatory = $true)]
    [string]$SourceRoot,

    [Parameter(Mandatory = $true)]
    [string]$OutputRoot,

    [int]$MaxTextureSize = 1024,
    [int]$JpegQuality = 82
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

function New-Directory {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Remove-DirectoryIfExists {
    param([string]$Path)
    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force
    }
}

function Copy-BuildTree {
    param(
        [string]$From,
        [string]$To
    )

    New-Directory -Path (Split-Path -Parent $To)
    Copy-Item -LiteralPath $From -Destination $To -Recurse -Force
}

function Get-Encoder {
    param([string]$MimeType)
    return [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
        Where-Object { $_.MimeType -eq $MimeType } |
        Select-Object -First 1
}

function Save-Jpeg {
    param(
        [System.Drawing.Bitmap]$Bitmap,
        [string]$Path,
        [int]$Quality
    )

    $encoder = Get-Encoder -MimeType 'image/jpeg'
    if ($null -eq $encoder) {
        $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Jpeg)
        return
    }

    $qualityEncoder = [System.Drawing.Imaging.Encoder]::Quality
    $parameters = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $parameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter($qualityEncoder, [int64]$Quality)
    try {
        $Bitmap.Save($Path, $encoder, $parameters)
    } finally {
        $parameters.Dispose()
    }
}

function Save-Png {
    param(
        [System.Drawing.Bitmap]$Bitmap,
        [string]$Path
    )

    $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Get-NewDimensions {
    param(
        [int]$Width,
        [int]$Height,
        [int]$MaxDimension
    )

    if ($Width -le $MaxDimension -and $Height -le $MaxDimension) {
        return @{
            Width = $Width
            Height = $Height
            Resized = $false
        }
    }

    if ($Width -ge $Height) {
        $ratio = $MaxDimension / [double]$Width
        return @{
            Width = $MaxDimension
            Height = [Math]::Max(1, [int][Math]::Round($Height * $ratio))
            Resized = $true
        }
    }

    $ratio = $MaxDimension / [double]$Height
    return @{
        Width = [Math]::Max(1, [int][Math]::Round($Width * $ratio))
        Height = $MaxDimension
        Resized = $true
    }
}

function Optimize-ImageFile {
    param(
        [string]$Path,
        [string]$RelativePath,
        [int]$MaxDimension,
        [int]$Quality
    )

    $extension = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
    $beforeBytes = (Get-Item -LiteralPath $Path).Length
    $result = @{
        relativePath = $RelativePath
        extension = $extension
        beforeBytes = [int64]$beforeBytes
        afterBytes = [int64]$beforeBytes
        optimized = $false
        resized = $false
        skipped = $false
        reason = ''
    }

    if ($extension -notin @('.png', '.jpg', '.jpeg', '.bmp')) {
        $result.skipped = $true
        $result.reason = 'unsupported-extension'
        return $result
    }

    $image = $null
    $bitmap = $null
    $resizedBitmap = $null
    $tempPath = "$Path.__optimized__"

    try {
        $image = [System.Drawing.Image]::FromFile($Path)
        # Built Cocos SpriteFrame metadata stores the original texture rect.
        # Safe bulk optimization must preserve dimensions or sprites can vanish.
        $dimensions = @{
            Width = $image.Width
            Height = $image.Height
            Resized = $false
        }
        $bitmap = New-Object System.Drawing.Bitmap($image)

        if ($dimensions.Resized) {
            $resizedBitmap = New-Object System.Drawing.Bitmap($dimensions.Width, $dimensions.Height)
            $graphics = [System.Drawing.Graphics]::FromImage($resizedBitmap)
            try {
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.DrawImage($bitmap, 0, 0, $dimensions.Width, $dimensions.Height)
            } finally {
                $graphics.Dispose()
            }
            $bitmap.Dispose()
            $bitmap = $resizedBitmap
            $resizedBitmap = $null
            $result.resized = $true
        }

        switch ($extension) {
            '.jpg' { Save-Jpeg -Bitmap $bitmap -Path $tempPath -Quality $Quality }
            '.jpeg' { Save-Jpeg -Bitmap $bitmap -Path $tempPath -Quality $Quality }
            '.png' { Save-Png -Bitmap $bitmap -Path $tempPath }
            '.bmp' { Save-Png -Bitmap $bitmap -Path $tempPath }
        }

        $afterBytes = (Get-Item -LiteralPath $tempPath).Length
        # Image.FromFile keeps the source locked until disposed, which prevented
        # the optimized temp file from ever replacing the build asset.
        $image.Dispose()
        $image = $null

        if ($afterBytes -lt $beforeBytes) {
            Move-Item -LiteralPath $tempPath -Destination $Path -Force
            $result.afterBytes = [int64](Get-Item -LiteralPath $Path).Length
            $result.optimized = $true
            return $result
        }

        Remove-Item -LiteralPath $tempPath -Force
        $result.skipped = $true
        $result.reason = 'no-gain'
        return $result
    } catch {
        if (Test-Path -LiteralPath $tempPath) {
            Remove-Item -LiteralPath $tempPath -Force
        }
        $result.skipped = $true
        $result.reason = $_.Exception.Message
        return $result
    } finally {
        if ($null -ne $resizedBitmap) { $resizedBitmap.Dispose() }
        if ($null -ne $bitmap) { $bitmap.Dispose() }
        if ($null -ne $image) { $image.Dispose() }
    }
}

$resolvedSource = [System.IO.Path]::GetFullPath($SourceRoot)
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputRoot)

if (-not (Test-Path -LiteralPath $resolvedSource)) {
    throw "SourceRoot not found: $resolvedSource"
}

if ($resolvedOutput.StartsWith($resolvedSource, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'OutputRoot cannot be nested inside SourceRoot.'
}

if ($MaxTextureSize -lt 64) {
    throw 'MaxTextureSize must be at least 64.'
}

if ($JpegQuality -lt 30 -or $JpegQuality -gt 95) {
    throw 'JpegQuality must be between 30 and 95.'
}

Remove-DirectoryIfExists -Path $resolvedOutput
Copy-BuildTree -From $resolvedSource -To $resolvedOutput

$allFiles = Get-ChildItem -LiteralPath $resolvedOutput -Recurse -File
$imageFiles = $allFiles | Where-Object { $_.Extension.ToLowerInvariant() -in @('.png', '.jpg', '.jpeg', '.bmp') }

$report = New-Object System.Collections.Generic.List[object]
foreach ($file in $imageFiles) {
    $relative = $file.FullName.Substring($resolvedOutput.Length).TrimStart('\', '/').Replace('\', '/')
    $report.Add((Optimize-ImageFile -Path $file.FullName -RelativePath $relative -MaxDimension $MaxTextureSize -Quality $JpegQuality))
}

$optimized = @($report | Where-Object { $_.optimized })
$totalBefore = ($allFiles | Measure-Object -Property Length -Sum).Sum
$totalAfter = (Get-ChildItem -LiteralPath $resolvedOutput -Recurse -File | Measure-Object -Property Length -Sum).Sum
$optimizedBefore = ($optimized | ForEach-Object { [int64]$_.beforeBytes } | Measure-Object -Sum).Sum
$optimizedAfter = ($optimized | ForEach-Object { [int64]$_.afterBytes } | Measure-Object -Sum).Sum

$result = [PSCustomObject]@{
    sourceRoot = $resolvedSource
    outputRoot = $resolvedOutput
    maxTextureSize = $MaxTextureSize
    jpegQuality = $JpegQuality
    totalFiles = @($allFiles).Count
    imageFiles = @($imageFiles).Count
    optimizedFiles = @($optimized).Count
    totalBeforeBytes = [int64]($totalBefore | ForEach-Object { if ($null -eq $_) { 0 } else { $_ } })
    totalAfterBytes = [int64]($totalAfter | ForEach-Object { if ($null -eq $_) { 0 } else { $_ } })
    optimizedBeforeBytes = [int64]($optimizedBefore | ForEach-Object { if ($null -eq $_) { 0 } else { $_ } })
    optimizedAfterBytes = [int64]($optimizedAfter | ForEach-Object { if ($null -eq $_) { 0 } else { $_ } })
    files = @($optimized | Sort-Object { $_.beforeBytes - $_.afterBytes } -Descending | Select-Object -First 100)
}

$result | ConvertTo-Json -Depth 6 -Compress
