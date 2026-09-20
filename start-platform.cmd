@echo off
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python 3.10+ is required. Please install Python and add it to PATH.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Please install Node.js and add it to PATH.
  pause
  exit /b 1
)
if not exist node_modules\@huggingface\transformers (
  call npm install
  if errorlevel 1 exit /b 1
)
call npm run setup:model
if errorlevel 1 (
  echo Model setup failed. Check the network and read README.md.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:8765 in Edge. Keep this window open.
python platform\server.py
pause
