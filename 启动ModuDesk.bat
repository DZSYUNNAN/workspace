@echo off
chcp 65001 >nul
title ModuDesk 模块化个人工作台
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  ==================================================
  echo    未检测到 Node.js,无法启动 ModuDesk
  echo.
  echo    请先安装 Node.js 长期维护版 LTS:
  echo        https://nodejs.org/zh-cn
  echo.
  echo    安装完成后重新双击「启动ModuDesk.bat」即可。
  echo  ==================================================
  echo.
  pause
  exit /b 1
)

if not exist "release\server.mjs" (
  echo  [错误] 未找到 release\server.mjs,请将压缩包完整解压后再运行。
  pause
  exit /b 1
)

echo  正在启动 ModuDesk,浏览器将自动打开 http://localhost:8080 ...
echo  停止运行:关闭本窗口即可。窗口请不要最小化到托盘以外关闭。
echo.
node "release\server.mjs"
echo.
echo  服务已停止。
pause
