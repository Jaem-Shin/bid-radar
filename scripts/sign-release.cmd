@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sign-release.ps1" %*
