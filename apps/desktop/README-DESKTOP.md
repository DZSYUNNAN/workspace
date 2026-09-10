# ModuDesk for Windows(Tauri 2 桌面壳)

Web 外壳与本仓库 `apps/web` 完全同源;本目录只包含原生适配层。
打包后获得真正的 Windows 10/11 应用:任务栏/窗口管理、本地文件系统、
**XeLaTeX / LuaLaTeX / pdfLaTeX 本地编译**、OS 钥匙串(下一迭代接入)。

## 前置要求(Windows)

1. [Node.js ≥ 18](https://nodejs.org)
2. [Rust](https://rustup.dev)(MSVC toolchain + Visual Studio Build Tools)
3. TeX 发行版(用于本地编译):[TeX Live](https://tug.org/texlive/) 或 [MiKTeX](https://miktex.org),确保 `xelatex` 在 PATH

## 开发运行

```powershell
# 仓库根目录
npm install
npm run build            # 先产出 apps/web/dist
cd apps/desktop/src-tauri
cargo tauri dev          # 或: cargo install tauri-cli --version ^2 && cargo tauri dev
```

## 打包安装程序

```powershell
cd apps/desktop/src-tauri
cargo tauri build        # 产出 .msi / .nsis 安装包(target/release/bundle)
```

## 已暴露的原生命令

| 命令 | 说明 |
|---|---|
| `compile_latex(source, engine, jobName)` | 临时目录内运行 TeX 引擎,返回 `{ ok, pdfBase64, log }` |
| `reveal_in_explorer(path)` | 在资源管理器中显示文件 |

前端在启动时检测 `window.__TAURI__` 并自动注册 native 编译适配器
(`apps/web/src/adapters/desktop.ts`),写作插件的「本地编译 PDF」按钮随即可用;
Web 配置下该按钮给出说明性提示。架构细节见 `ARCHITECTURE.md` §8。
