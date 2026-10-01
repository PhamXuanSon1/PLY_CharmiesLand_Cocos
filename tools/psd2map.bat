@echo off
setlocal EnableExtensions
chcp 65001 >nul
title PSD -^> Map (SceneBuilder)

rem ===========================================================================
rem  psd2map.bat - keo tha file .psd vao file nay (hoac double-click roi dan
rem  duong dan). Xuat PNG + JSON vao assets/3.Sprites/<ten psd>/ cho SceneBuilder.
rem ===========================================================================

rem Chay tu thu muc goc project (tools\..)
cd /d "%~dp0.."

rem ---- 1. File PSD ----------------------------------------------------------
set "PSD=%~1"
if "%PSD%"=="" (
    echo Keo tha file .psd vao cua so nay roi nhan Enter:
    set /p "PSD=> "
)
set "PSD=%PSD:"=%"
if not exist "%PSD%" (
    echo [LOI] Khong thay file: "%PSD%"
    goto :end
)
for %%F in ("%PSD%") do set "PSDNAME=%%~nF"

rem ---- 2. Python + psd-tools ------------------------------------------------
where python >nul 2>nul || (
    echo [LOI] Chua cai Python. Tai o https://www.python.org/downloads/ ^(tick "Add to PATH"^).
    goto :end
)
python -c "import psd_tools" >nul 2>nul || (
    echo Chua co psd-tools, dang cai...
    python -m pip install psd-tools || ( echo [LOI] Cai psd-tools that bai. & goto :end )
)

rem ---- 3. Artboard ----------------------------------------------------------
echo.
python tools\psd2map.py "%PSD%" --list || goto :end
echo.
set "AB="
set /p "AB=Ten artboard (Enter = artboard dau tien): "

rem ---- 4. Tuy chon ----------------------------------------------------------
set "HID="
set /p "HID=Xuat ca layer dang AN? (y/N): "

set "OUT=assets/3.Sprites/%PSDNAME%"
set "OUTIN="
set /p "OUTIN=Thu muc xuat (Enter = %OUT%): "
if not "%OUTIN%"=="" set "OUT=%OUTIN:"=%"

:run
echo.
echo ===========================================================================
echo  PSD     : %PSD%
echo  Artboard: %AB%
echo  Hidden  : %HID%
echo  Out     : %OUT%
if exist "%OUT%\%PSDNAME%.names.json" (
    echo  Names   : %OUT%\%PSDNAME%.names.json ^(se doi ten node^)
) else (
    echo  Names   : ^(chua co %PSDNAME%.names.json - giu ten layer goc^)
)
echo ===========================================================================
echo.

set "OPT="
if /i "%HID%"=="y" set "OPT=--hidden"
if "%AB%"=="" (
    python tools\psd2map.py "%PSD%" --out "%OUT%" %OPT%
) else (
    python tools\psd2map.py "%PSD%" --out "%OUT%" --artboard "%AB%" %OPT%
)
if errorlevel 1 ( echo. & echo [LOI] Xuat that bai, xem log o tren. & goto :again )

echo.
echo  XONG. Buoc tiep theo trong Cocos:
echo   1. Doi import xong, kiem tra PNG trong "%OUT%/sprites" la Type = sprite-frame
echo   2. Node rong duoi Canvas -^> Add Component Pipeline/SceneBuilder
echo   3. Keo "%PSDNAME%.json" vao Scene Json, folder "sprites" vao Sprite Folder
echo   4. Tick Build Now -^> Ctrl+S
echo.
echo  Muon doi ten node: tao "%OUT%\%PSDNAME%.names.json" roi nhan R de chay lai.

:again
echo.
set "AGAIN="
set /p "AGAIN=[R] chay lai voi cung tuy chon, [O] mo thu muc xuat, Enter de thoat: "
if /i "%AGAIN%"=="r" goto :run
if /i "%AGAIN%"=="o" ( start "" "%OUT:/=\%" & goto :again )
exit /b 0

:end
echo.
pause
