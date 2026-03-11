@echo off
setlocal

set IMAGE_NAME=mosquito-threat-enricher
set CONTAINER_NAME=mosquito-threat-enricher
set SCRIPT_DIR=%~dp0
set STORAGE_DIR=%SCRIPT_DIR%storage

if not exist "%STORAGE_DIR%" mkdir "%STORAGE_DIR%"

docker build -t %IMAGE_NAME% "%SCRIPT_DIR%"
if errorlevel 1 exit /b %errorlevel%

for /f "delims=" %%i in ('docker ps -a --format "{{.Names}}" ^| findstr /x /c:%CONTAINER_NAME%') do (
  docker rm -f %CONTAINER_NAME% >nul
)

docker run -d ^
  --name %CONTAINER_NAME% ^
  -p 8000:8000 ^
  -e DATABASE_URL=sqlite:////app/storage/mosquito.db ^
  -v "%STORAGE_DIR%:/app/storage" ^
  %IMAGE_NAME%

if errorlevel 1 exit /b %errorlevel%

echo mosquito: threat enricher is starting on http://localhost:8000
