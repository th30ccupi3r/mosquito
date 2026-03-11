@echo off
setlocal

set IMAGE_NAME=mosquito-threat-enricher
set SCRIPT_DIR=%~dp0

docker build -t %IMAGE_NAME% "%SCRIPT_DIR%"
if errorlevel 1 exit /b %errorlevel%

echo Built Docker image: %IMAGE_NAME%
