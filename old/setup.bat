@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher "py" was not found.
  echo Install Python 3.11 from python.org, then run this file again.
  pause
  exit /b 1
)
if not exist .venv (
  py -3.11 -m venv .venv
  if errorlevel 1 (
    echo Could not create the virtual environment with Python 3.11.
    pause
    exit /b 1
  )
)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo Dependency installation failed.
  pause
  exit /b 1
)
echo.
echo EasyMocap is ready.
pause
