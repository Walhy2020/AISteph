# AISteph

AISteph 是一个本地优先的个人信息收集与整理工具。它把文字、文章链接、文件以及后续接入的录音统一放入收件箱，再由用户审核后沉淀到 Obsidian 知识库。

当前版本：**v0.1.0**

## 当前可运行能力

- 初始化本地数据目录和 Obsidian Vault 目录。
- 快速收录一段文字。
- 保存文章链接及其来源信息。
- 导入本地文件，并使用 SHA-256 标记内容。
- 为每条来源生成统一 JSON 记录、处理队列和 Obsidian 待审核笔记。
- 写入不包含正文的结构化 JSONL 日志。

## 快速开始

要求 Node.js 20 或更高版本。

```powershell
npm run start -- init
npm run start -- add-text --title "临时想法" --text "需要整理的内容"
npm run start -- add-link "https://example.com/article" --title "待读文章"
npm run start -- import-file ".\\资料\\示例.pdf"
```

查看帮助和版本：

```powershell
npm run start -- --help
npm run start -- --version
```

## 目录原则

- `./data`：原始资料、统一记录和后台队列。
- `./vault`：Obsidian 可见的候选知识与正式知识。
- `./logs`：结构化运行日志。
- `./config`：只使用相对路径的本地配置。

运行数据默认不提交到 Git，避免个人信息被意外上传。

详细设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 和 [docs/V0.1.0.md](docs/V0.1.0.md)。
