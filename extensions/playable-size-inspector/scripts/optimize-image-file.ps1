param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [int]$MaxTextureSize = 1024,
    [int]$JpegQuality = 82,
    [string]$TargetFormat = 'original',
    [int]$KeepLargerOutputFlag = 0,
    [int]$AllowResizeFlag = 0
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$KeepLargerOutput = ($KeepLargerOutputFlag -ne 0)
$AllowResize = ($AllowResizeFlag -ne 0)

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

function Get-HasEffectiveAlpha {
    param([System.Drawing.Bitmap]$Bitmap)

    if (-not [System.Drawing.Image]::IsAlphaPixelFormat($Bitmap.PixelFormat)) {
        return $false
    }

    for ($y = 0; $y -lt $Bitmap.Height; $y++) {
        for ($x = 0; $x -lt $Bitmap.Width; $x++) {
            if ($Bitmap.GetPixel($x, $y).A -lt 255) {
                return $true
            }
        }
    }

    return $false
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
        [string]$SourcePath,
        [string]$DestinationPath,
        [int]$MaxDimension,
        [int]$Quality,
        [string]$FormatMode,
        [bool]$CanResize
    )

    $extension = [System.IO.Path]::GetExtension($SourcePath).ToLowerInvariant()
    if ($extension -notin @('.png', '.jpg', '.jpeg', '.bmp')) {
        throw "Unsupported image extension: $extension"
    }

    $outputDir = Split-Path -Parent $DestinationPath
    if (-not (Test-Path -LiteralPath $outputDir)) {
        New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
    }

    $beforeBytes = (Get-Item -LiteralPath $SourcePath).Length
    $image = $null
    $bitmap = $null
    $resizedBitmap = $null
    $tempOutputPath = "$DestinationPath.__temp__"

    try {
        $image = [System.Drawing.Image]::FromFile($SourcePath)
        $dimensions = if ($CanResize) {
            Get-NewDimensions -Width $image.Width -Height $image.Height -MaxDimension $MaxDimension
        } else {
            @{
                Width = $image.Width
                Height = $image.Height
                Resized = $false
            }
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
        }

        $hasAlpha = Get-HasEffectiveAlpha -Bitmap $bitmap
        $outputFormat = $extension

        switch ($FormatMode.ToLowerInvariant()) {
            'jpeg' { $outputFormat = '.jpg' }
            'jpg' { $outputFormat = '.jpg' }
            'png' { $outputFormat = '.png' }
            'auto' {
                if ($hasAlpha) {
                    $outputFormat = '.png'
                } elseif ($extension -in @('.png', '.bmp', '.jpg', '.jpeg')) {
                    $outputFormat = '.jpg'
                }
            }
            default { $outputFormat = $extension }
        }

        switch ($outputFormat) {
            '.jpg' { Save-Jpeg -Bitmap $bitmap -Path $tempOutputPath -Quality $Quality }
            '.jpeg' { Save-Jpeg -Bitmap $bitmap -Path $tempOutputPath -Quality $Quality }
            '.png' { Save-Png -Bitmap $bitmap -Path $tempOutputPath }
            '.bmp' { Save-Png -Bitmap $bitmap -Path $tempOutputPath }
        }

        $afterBytes = (Get-Item -LiteralPath $tempOutputPath).Length
        $hasGain = $afterBytes -lt $beforeBytes

        if ($KeepLargerOutput -or $hasGain) {
            Move-Item -LiteralPath $tempOutputPath -Destination $DestinationPath -Force
        } else {
            if (Test-Path -LiteralPath $DestinationPath) {
                Remove-Item -LiteralPath $DestinationPath -Force
            }
            Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath -Force
            Remove-Item -LiteralPath $tempOutputPath -Force
        }

        $finalBytes = (Get-Item -LiteralPath $DestinationPath).Length
        return [PSCustomObject]@{
            inputPath = [System.IO.Path]::GetFullPath($SourcePath)
            outputPath = [System.IO.Path]::GetFullPath($DestinationPath)
            extension = $extension
            outputFormat = $outputFormat
            beforeBytes = [int64]$beforeBytes
            afterBytes = [int64]$finalBytes
            originalWidth = [int]$image.Width
            originalHeight = [int]$image.Height
            outputWidth = [int]$bitmap.Width
            outputHeight = [int]$bitmap.Height
            hasAlpha = [bool]$hasAlpha
            resized = [bool]$dimensions.Resized
            optimized = [bool]$hasGain
            skippedReason = if ($hasGain) { '' } else { 'no-gain' }
        }
    } finally {
        if (Test-Path -LiteralPath $tempOutputPath) {
            Remove-Item -LiteralPath $tempOutputPath -Force
        }
        if ($null -ne $resizedBitmap) { $resizedBitmap.Dispose() }
        if ($null -ne $bitmap) { $bitmap.Dispose() }
        if ($null -ne $image) { $image.Dispose() }
    }
}

$resolvedInput = [System.IO.Path]::GetFullPath($InputPath)
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)

if (-not (Test-Path -LiteralPath $resolvedInput)) {
    throw "InputPath not found: $resolvedInput"
}

if ($MaxTextureSize -lt 64) {
    throw 'MaxTextureSize must be at least 64.'
}

if ($JpegQuality -lt 30 -or $JpegQuality -gt 95) {
    throw 'JpegQuality must be between 30 and 95.'
}

$result = Optimize-ImageFile -SourcePath $resolvedInput -DestinationPath $resolvedOutput -MaxDimension $MaxTextureSize -Quality $JpegQuality -FormatMode $TargetFormat -CanResize $AllowResize
$result | ConvertTo-Json -Depth 4 -Compress
