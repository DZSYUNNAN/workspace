#!/usr/bin/env bash
# ModuDesk 一键启动(macOS / Linux):只需 Node.js ≥ 18,无需 npm install。
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  未检测到 Node.js,无法启动 ModuDesk。"
  echo "  请先安装 Node.js LTS:https://nodejs.org/zh-cn"
  echo "  安装完成后重新运行本脚本即可。"
  echo
  exit 1
fi

if [ ! -f "release/server.mjs" ]; then
  echo "  [错误] 未找到 release/server.mjs,请将压缩包完整解压后再运行。"
  exit 1
fi

echo "  正在启动 ModuDesk,浏览器将自动打开 http://localhost:8080 ..."
echo "  停止运行:按 Ctrl+C 或关闭本终端窗口。"
node release/server.mjs
