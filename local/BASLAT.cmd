@echo off
cd /d "%~dp0"
set "NODE_BIN=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    set "NODE_BIN=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  ) else (
    echo Node.js 24 veya daha yeni bir surum kurmaniz gerekiyor.
    echo Kurulumdan sonra bu dosyayi yeniden acin.
    pause
    exit /b 1
  )
)
"%NODE_BIN%" -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
if errorlevel 1 (
  echo Node.js 24 veya daha yeni bir surum gerekli.
  pause
  exit /b 1
)
echo POWERPOOL ServiceHub baslatiliyor...
echo Sunucu hazir oldugunda tarayicinizda http://127.0.0.1:4174 adresini acin.
echo Bu pencereyi kapatirsaniz sunucu durur.
"%NODE_BIN%" server.mjs
pause
