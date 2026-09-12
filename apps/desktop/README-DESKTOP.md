# ModuDesk 0.6.2 Windows 桌面版

桌面版与 Web 共用界面和 SQL 引擎。SQLite 快照及附件保存在原生应用数据目录；密钥使用 Windows 凭据管理器。使用和迁移步骤见 [稳定版指南](../../docs/STABLE-GUIDE.md)。

## 构建

需要 Node.js 22、Rust stable MSVC、Visual Studio C++ Build Tools 和 WebView2。
在仓库根目录执行：

```powershell
npm ci
npm run desktop:dev
# 发布构建自动先构建 Web
npm run desktop:build
```

输出 `src-tauri/target/release/modudesk.exe` 及 `src-tauri/target/release/bundle/nsis/ModuDesk_0.6.2_x64-setup.exe`。当前只生成 NSIS 安装包，未代码签名。

## 原生能力

- 单实例窗口；正常关闭前等待数据库保存。
- SQLite 快照原子替换，恢复先建立完整数据代次再切换指针，保留上一代。
- 附件读写与 Windows 凭据存取；未开放通用 shell 命令。
- TeX 引擎白名单：XeLaTeX、LuaLaTeX、pdfLaTeX。支持工程内 `.tex` / `.bib`，按需运行 BibTeX；临时目录、路径校验、禁用 shell escape、每进程 60 秒超时。
- TeX Live / MiKTeX 是独立前置依赖，安装器不捆绑它们。

## 测试

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
# 在 Windows 用户会话中，且安装 TeX 后运行完整集成检查
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked -- --include-ignored
```

完整检查会创建并删除随机命名的测试凭据，并实际编译中文多文件参考文献工程；不读取个人密钥。
