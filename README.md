# 简录制器

简录制器是一款面向教程、演示、课程、产品讲解场景的桌面录制工具。它的目标不是替代专业剪辑软件，而是把「录制 -> 素材整理 -> 合并导出 -> 生成剪映草稿」这一步做得更顺手。

## 已实现功能

- Electron 桌面应用。
- 普通录制 / 多段录制，默认多段录制。
- 支持选择屏幕或窗口作为录制源。
- 支持系统声音、麦克风、系统声音 + 麦克风、静音模式。
- 支持录制范围预设：16:9、4:3、3:4、9:16、1:1、Custom。
- 支持自定义保存目录和剪映草稿目录。
- 普通录制完成后直接保存到指定目录。
- 多段录制完成后进入素材面板，可排序、重命名、删除。
- 素材面板支持导入文件夹，按文件名顺序读取视频片段。
- 导入文件夹时自动关联同名 `_events.json`，没有则跳过。
- 支持保存项目 `project.json`。
- 支持使用 ffmpeg 合并导出 mp4。
- 支持生成剪映草稿配置并直接写入剪映草稿目录。
- 内置剪映草稿生成脚本，不依赖外部 `.skills` 目录。
- 支持一键“去口癖生成草稿”，按片段分析口癖、重复和长停顿后生成剪映草稿。
- 点击事件 `_events.json` 默认关闭，可在设置中手动开启，用于后续生成剪映关键帧。
- 应用退出时会清理由应用启动的子进程。

默认剪映草稿目录：

```text
D:\剪映输出物\JianyingPro Drafts
```

## 环境要求

- Windows。
- Node.js 18+。
- npm。
- ffmpeg / ffprobe 可在命令行中访问。
- Python 3.10+，用于剪映草稿生成和去口癖流程。

## 本地启动

```bash
npm.cmd install
npm.cmd start
```

## 项目结构

```text
src/
  main.js                 Electron 主进程
  preload.js              安全暴露 IPC API
  renderer/
    index.html            主界面
    renderer.js           录制与素材面板逻辑
    styles.css            页面样式
tools/
  verbal_cleaner_runner.py
vendor/
  1-2-_capabilities-jianying-draft-tools/
  27-_workflows-verbal-cleaner/
docs/
  简录制器产品需求文档.md
  页面线框图.md
```

## 仓库说明

仓库只提交源码、文档和内置脚本，不提交以下内容：

- `node_modules/`
- `dist/`
- 打包后的安装包或便携版目录
- 录制视频、导出视频、剪映草稿输出
- Python `__pycache__` / `.pyc`

## 下一步

- 增加安装包打包配置。
- 去口癖流程增加“只分析并预览剪辑点”模式。
- 增加剪辑点人工确认能力。
