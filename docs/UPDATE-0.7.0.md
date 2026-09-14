# ModuDesk 0.7.0 本地论文写作工作台

## 新功能

- 将 DKDFusion `paper_writer_ui` 的核心工作流迁移到原生写作插件，不启动本地网页服务，也不使用 iframe。
- 本地 `paper.tex` 左侧编辑、右侧 PDF.js 连续审阅，支持缩放、横向滑动和拖动分栏。
- “保存并编译”是唯一刷新 PDF 的入口；输入、自动保存和 AI 请求保留上次编译结果。
- 编译启用 SyncTeX。双击 PDF 文本可定位并选中主 TeX 文件中的对应源码；依赖文件位置会显示文件名和行号。
- 论文 AI 输出区提供自由指令、中英互译、学术润色、审稿风险检查、论文结构解释和章节改写。
- 新增 DeepSeek-V4-Flash（江苏师大）AI 预设，endpoint 为 `https://model.jsnu.edu.cn/v1/chat/completions`，模型为 `deepseek-v4-flash`。密钥只保存在安全存储中。
- AI 网络设置支持仅直连、环境代理、Windows 系统代理、指定代理和自动回退；Karing 可填写 `http://127.0.0.1:3067`。

## 安全与兼容

- LaTeX 继续禁用 shell escape，并沿用引用图依赖收集、100 MB / 500 个实际依赖限制和路径越界校验。
- SyncTeX 坐标查询通过参数化进程调用执行，不拼接 shell 命令。
- 编译产物和 SyncTeX 映射只保存在当前进程内存中；重新读取文件会清除旧 PDF。

## 验证

- TypeScript 类型检查、Vitest 全套测试、Rust 单元测试和生产构建。
- 使用本机 XeLaTeX/BibTeX 实际编译含中文、多文件、图片、自定义类和参考文献的工程，并完成 PDF → SyncTeX 反向定位。
