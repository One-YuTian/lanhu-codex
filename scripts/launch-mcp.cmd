@echo off
node "%~dp0..\package\index.cjs" %*
exit /b %errorlevel%
