# AISteph

AISteph 是一个本地优先的个人信息收集与整理工具。它把文字、文章链接、文件以及后续接入的录音统一放入收件箱，再由用户审核后沉淀到 Obsidian 知识库。

当前版本：**v0.3.0**

## 当前可运行能力

- PC本地统一收件箱管理台。
- 快速收录文字、文章链接、本地文件和手动事件录音。
- 枚举并选择 Windows 麦克风，通过 FFmpeg 保存本地 Opus 音频。
- 停止录音后自动校验音频并进入统一收件箱。
- 查看资料总数、待审核数量、类型和来源。
- 初始化本地数据目录和 Obsidian Vault 目录。
- 使用 SHA-256 标记来源内容，大文件采用流式计算。
- 为每条来源生成统一 JSON 记录、处理队列和 Obsidian 待审核笔记。
- 写入不包含正文的结构化 JSONL 日志。
- 仅绑定 `127.0.0.1`，使用进程令牌和同源校验保护写入接口。

## 启动PC管理台

要求 Node.js 20 或更高版本，并确保 ffmpeg、ffprobe 可在命令行直接执行。

```powershell
npm run web
```

默认访问地址：

```text
http://127.0.0.1:39310
```

管理台和页脚都会显示当前版本。按 `Ctrl+C` 停止服务。

## 命令行入口

```powershell
npm run start -- init
npm run start -- add-text --title "临时想法" --text "需要整理的内容"
npm run start -- add-link "https://example.com/article" --title "待读文章"
npm run start -- import-file ".\\资料\\示例.pdf"
npm run start -- --version
```

## 目录原则

- `./data`：原始资料、`./data/audio/YYYY-MM-DD/REC-*.opus` 录音、统一记录和后台队列。
- `./vault`：Obsidian 可见的候选知识与正式知识。
- `./logs`：结构化运行日志。
- `./config`：只使用相对路径的本地配置。

运行数据默认不提交到 Git，避免个人信息被意外上传。

详细设计见：

- [总体架构](docs/ARCHITECTURE.md)
- [v0.1.0统一收件箱内核](docs/V0.1.0.md)
- [v0.2.0 PC管理台](docs/V0.2.0.md)
- [v0.3.0 PC手动事件录音](docs/V0.3.0.md)
