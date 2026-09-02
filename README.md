# AISteph

AISteph 是一个本地优先的个人录音与知识整理工具。当前阶段聚焦 PC 录音：声音保存在本机，停止后进入录音资料库，等待后续 AI 分析和用户确认，再沉淀到 Obsidian 知识库。

当前版本：**v0.7.0**

## 当前可运行能力

- PC 本地录音工作台，页面只展示录音相关功能。
- AISteph Voice 完整 Windows 客户端：一个入口自动启动录音服务并内嵌管理工作台。
- Windows 全局快捷键 `Ctrl + Alt + R`：无需打开主窗口即可开始或停止录音。
- 单实例运行、关闭到托盘、重复启动唤醒已有窗口，并通过系统通知反馈录音结果。
- 启动时及每 12 小时检查 GitHub Releases 稳定版本，托盘菜单也可手动检查更新。
- 按 `DESIGN.md` 提供的 Notion 设计系统重构白色导航、深蓝录音主视觉、工作区预览卡和彩色资料库。
- 枚举并选择 Windows 麦克风，通过 FFmpeg 保存本地 Opus 音频。
- 显示实时录音状态、设备和持续时长。
- 停止录音后自动校验并进入录音资料库。
- 统计录音总数、累计时长和等待确认数量。
- 在浏览器中直接播放历史录音，同一时间只播放一条。
- 可在二次确认后删除单条录音，并同步清理处理队列和 Obsidian 待审核笔记。
- 空闲时自动监测麦克风连接状态，耳机进盒后清空失效选择，重新连接后自动恢复。
- 播放接口支持签名 URL、HEAD 和 HTTP Range 分段读取。
- 为每段录音生成统一 JSON 记录、处理队列和 Obsidian 待审核笔记。
- 写入不包含音频正文的结构化 JSONL 日志。
- 仅绑定 `127.0.0.1`，使用进程令牌、签名播放地址和同源校验。
- 文字、文章链接和文件收录接口继续保留，但暂不在页面展示。

## 启动 AISteph Voice

日常使用只需双击发布目录中的：

```text
AIStephVoice.exe
```

客户端会自动启动内部录音服务并打开工作台，不需要先运行命令，也不需要打开浏览器。关闭主窗口后客户端继续在系统托盘运行；右键托盘图标可以打开窗口、开始/停止录音、检查更新或退出。

第一次使用时在客户端窗口中选择实体麦克风并设置增益。此后在任意 Windows 界面按 `Ctrl + Alt + R` 开始录音，再按一次停止并保存。如果最后确认的耳机已经断开，客户端会取消录音并提示，不会自动改用网易虚拟音频或其他麦克风。

开发模式仍可单独启动网页服务：

```powershell
npm run web
```

构建与发布客户端：

```powershell
npm run build:voice
npm run publish:voice
```

发布结果位于 `dist/AIStephVoice`。发布脚本会把当前 Node、FFmpeg 和 FFprobe 运行文件放入客户端内部，目标电脑日常使用不需要单独启动这些组件。
## 当前处理流程

```text
录音 → 本地 Opus 文件 → 录音资料库 → 后续 AI 分析 → 用户确认 → 知识库存储
```

v0.4.0 只完成到“录音资料库”。音频分析、确认界面和自动入库尚未接入。

## 保留的命令行入口

```powershell
npm run start -- init
npm run start -- add-text --title "临时想法" --text "需要整理的内容"
npm run start -- add-link "https://example.com/article" --title "待读文章"
npm run start -- import-file ".\资料\示例.pdf"
npm run start -- --version
```

这些多来源能力作为底层接口保留，当前录音工作台页面不提供对应入口。

## 目录原则

- `./data`：原始资料、`./data/audio/YYYY-MM-DD/REC-*.opus` 录音、统一记录和后台队列。
- `./vault`：Obsidian 可见的候选知识与正式知识。
- `./logs`：结构化运行日志。
- `./config`：只使用相对路径的本地配置。

运行数据默认不提交到 Git，避免个人信息被意外上传。

详细设计见：

- [总体架构](docs/ARCHITECTURE.md)
- [页面设计系统](DESIGN.md)
- [v0.1.0 统一收件箱内核](docs/V0.1.0.md)
- [v0.2.0 PC 管理台](docs/V0.2.0.md)
- [v0.3.0 PC 手动事件录音](docs/V0.3.0.md)
- [v0.4.0 录音工作台与在线播放](docs/V0.4.0.md)
- [v0.4.1 紧凑录音工作台](docs/V0.4.1.md)
- [v0.4.2 录音增益设置](docs/V0.4.2.md)
- [v0.4.3 实时录音声纹](docs/V0.4.3.md)
- [v0.4.4 录音设备防误选](docs/V0.4.4.md)
- [v0.4.5 录音安全删除](docs/V0.4.5.md)
- [v0.4.6 录音设备在线监测](docs/V0.4.6.md)
- [v0.5.0 Apple 风格工作台](docs/V0.5.0.md)
- [v0.5.1 BMW Corporate 工作台](docs/V0.5.1.md)
- [v0.5.2 Notion 录音工作区](docs/V0.5.2.md)
- [v0.6.0 Windows 全局快捷录音](docs/V0.6.0.md)
- [v0.7.0 AISteph Voice Windows 客户端](docs/V0.7.0.md)
