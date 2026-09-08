@echo off
setlocal
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo EasyMocap is not installed yet. Running setup...
  call setup.bat
)
.venv\Scripts\python.exe app.py
if errorlevel 1 pause
