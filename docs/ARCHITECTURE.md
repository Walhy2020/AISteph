# AISteph 架构说明

## 目标

AISteph 的核心不是“保存所有内容”，而是让不同来源的信息经过同一条可追溯、可审核的处理链：

```text
文字 / 链接 / 文件 / 录音（后续）
                  ↓
              统一收件箱
                  ↓
          解析、转写、摘要、分类
                  ↓
             候选知识卡
                  ↓ 用户确认
           Obsidian 正式知识
```

## 数据分层

1. 原始资料：保留来源和内容哈希，不由 AI 覆盖。
2. 候选信息：统一进入 `./vault/00_Inbox`，状态为 `pending_review`。
3. 正式知识：只有用户确认后才进入 `./vault/30_Knowledge`。

Obsidian Markdown 是正式知识的唯一事实来源。运行队列和状态数据是辅助信息，未来的向量索引也是可重建的派生数据。

## 统一来源记录

每个来源都有以下基础字段：

- `id`
- `type`
- `status`
- `title`
- `capturedAt`
- `visibility`
- `contentHash`
- `sourceUrl`
- `sourcePath`
- `inboxNotePath`
- `schemaVersion`

录音模块以后只增加音频时长、设备、转写路径等字段，不另建一套孤立模型。

## 可靠性边界

- 采集成功后先落本地原始资料，再创建分析任务。
- 日志不得保存完整正文、密钥或敏感内容。
- 所有内部存储路径必须相对项目工作目录配置，并阻止 `../` 逃逸。
- AI、网络或 Obsidian 分析失败不能删除原始资料。
- 重复内容以后通过内容哈希检测；v0.1.0 先保留每次用户明确执行的收录记录。

## 后续模块边界

- Windows Recorder：独立进程，负责麦克风、VAD、分段和本地队列。
- Analyzer：负责转写、解析、摘要和候选知识提取。
- Desktop UI：负责托盘状态、统一收件箱、审核和配置。

Recorder 与 Analyzer 必须解耦，分析失败不能中断录音。
