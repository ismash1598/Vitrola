@echo off
setlocal
title Vitrola
cd /d "%~dp0"

echo.
echo  ===== Vitrola =====
echo.

rem --- 1. Node.js -----------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 goto sem_node

node -e "process.exit(Number(process.versions.node.split('.')[0])>=18?0:1)"
if errorlevel 1 (
  echo Seu Node.js e muito antigo. O Vitrola precisa da versao 18 ou mais nova.
  goto sem_node_msg
)

rem --- 2. Dependencias ------------------------------------------------------
echo Verificando dependencias (na primeira vez demora um pouco)...
call npm install --omit=dev --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  if not exist node_modules (
    echo.
    echo Nao consegui instalar as dependencias. Verifique sua internet e tente de novo.
    pause
    exit /b 1
  )
  echo Aviso: nao deu pra atualizar as dependencias, usando as que ja estao instaladas.
)

rem --- 3. yt-dlp em dia (o YouTube muda toda hora e quebra versoes velhas) ---
if exist "node_modules\yt-dlp-exec\bin\yt-dlp.exe" (
  echo Atualizando o yt-dlp...
  "node_modules\yt-dlp-exec\bin\yt-dlp.exe" -U >nul 2>nul
)

rem --- 4. Iniciar -----------------------------------------------------------
echo.
echo Iniciando o Vitrola. Deixe esta janela aberta - se fechar, o bot desliga.
echo.
set VITROLA_OPEN_BROWSER=1
node src\index.js %*

echo.
echo O Vitrola foi encerrado.
pause
exit /b

:sem_node
echo Node.js nao encontrado.
where winget >nul 2>nul
if errorlevel 1 goto sem_node_msg
echo Tentando instalar automaticamente (pode pedir permissao)...
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
echo.
echo Se a instalacao terminou, FECHE esta janela e abra o Iniciar.bat de novo.
pause
exit /b

:sem_node_msg
echo.
echo Instale o Node.js (versao LTS) em https://nodejs.org e abra o Iniciar.bat de novo.
start "" https://nodejs.org
pause
exit /b 1
