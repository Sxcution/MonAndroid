@echo off
setlocal

:: Timestamp
for /f "usebackq delims=" %%a in (`powershell -Command "Get-Date -Format 'HH-mm_dd-MM-yyyy'"`) do set "TIMESTAMP=%%a"
set "OUTPUT_ZIP=AIreview_%TIMESTAMP%.zip"

echo ========================================================
echo DONG GOI SOURCE CODE
echo Output: %OUTPUT_ZIP%
echo ========================================================

if exist "%OUTPUT_ZIP%" del "%OUTPUT_ZIP%"

:: Get parent directory path
cd ..
set "ROOT_DIR=%CD%"
cd AI_Review

:: Create PowerShell script
echo $root = '%ROOT_DIR%' > _zip.ps1
echo $temp = Join-Path $env:TEMP ('AIR_' + (Get-Random)) >> _zip.ps1
echo New-Item -ItemType Directory -Path $temp -Force ^| Out-Null >> _zip.ps1
echo. >> _zip.ps1
echo $exts = @('.go','.ts','.tsx','.js','.jsx','.css','.html','.json','.md','.bat') >> _zip.ps1
echo $exclude = @('node_modules','.git','dist','build','.gemini','AI_Review') >> _zip.ps1
echo. >> _zip.ps1
echo $files = Get-ChildItem -Path $root -Recurse -File ^| Where-Object { >> _zip.ps1
echo     $exts -contains $_.Extension -and >> _zip.ps1
echo     -not ($exclude ^| ForEach-Object { $f = $_; $_.FullName -like "*\$f\*" } ^| Where-Object { $_ }) >> _zip.ps1
echo } >> _zip.ps1
echo. >> _zip.ps1
echo Write-Host "Found $($files.Count) files" -ForegroundColor Green >> _zip.ps1
echo. >> _zip.ps1
echo foreach ($f in $files) { >> _zip.ps1
echo     $skip = $false >> _zip.ps1
echo     foreach ($ex in $exclude) { if ($f.FullName -like "*\$ex\*") { $skip = $true; break } } >> _zip.ps1
echo     if ($skip) { continue } >> _zip.ps1
echo     $rel = $f.FullName.Substring($root.Length + 1) >> _zip.ps1
echo     $dest = Join-Path $temp $rel >> _zip.ps1
echo     $dir = Split-Path $dest -Parent >> _zip.ps1
echo     if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force ^| Out-Null } >> _zip.ps1
echo     Copy-Item $f.FullName $dest >> _zip.ps1
echo } >> _zip.ps1
echo. >> _zip.ps1
echo Compress-Archive -Path "$temp\*" -DestinationPath '%OUTPUT_ZIP%' -Force >> _zip.ps1
echo Remove-Item $temp -Recurse -Force >> _zip.ps1
echo Write-Host "Done!" -ForegroundColor Green >> _zip.ps1

powershell -NoProfile -ExecutionPolicy Bypass -File _zip.ps1
del _zip.ps1

echo.
echo ========================================================
echo HOAN TAT! File: AI_Review\%OUTPUT_ZIP%
echo ========================================================
pause