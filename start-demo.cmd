@echo off
chcp 65001 >nul
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js/npm，请先安装 Node.js 22.12 或更高版本。
  pause
  exit /b 1
)
if not exist node_modules (
  echo 首次运行，正在安装依赖...
  call npm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败。
    pause
    exit /b 1
  )
)
call npm run setup:model
if errorlevel 1 (
  echo [错误] 模型准备失败，请检查网络并查看 README.md。
  pause
  exit /b 1
)
echo 浏览器地址：http://127.0.0.1:5173
call npm run dev
pause
