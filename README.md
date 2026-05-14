# 简录制器

简录制器是一款面向教程、演示、课程、产品讲解场景的桌面录制工具。它的目标不是替代专业剪辑软件，而是把「录制 -> 素材整理 -> 合并导出 -> 生成剪映草稿」这一步做得更顺手。

适合这些场景：

- 录制课程、教程、产品演示。
- 多次录制短片段，再统一整理。
- 把录好的素材直接生成剪映草稿，进入剪映继续精剪。
- 对录制素材做初步处理，例如合并导出、去口癖生成草稿。

## 功能特性

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
- 支持生成剪映草稿配置，并直接写入剪映草稿目录。
- 内置剪映草稿生成脚本，不依赖外部 `.skills` 目录。
- 支持一键“去口癖生成草稿”，按片段分析口癖、重复和长停顿后生成剪映草稿。
- 点击事件 `_events.json` 默认关闭，可在设置中手动开启，用于后续生成剪映关键帧。
- 应用退出时会清理由应用启动的子进程。

## 使用方式

### 方式一：普通用户试用

如果你只是想试用软件，不需要克隆源码。

1. 到仓库的 Releases 页面下载 Windows 压缩包。
2. 解压压缩包。
3. 双击运行 `简录制器.exe`。

如果当前仓库还没有发布 Release，可以让作者提供 `dist` 目录下打包好的压缩包。

注意：当前版本仍然依赖本机环境。录制基础功能可以直接试用，但合并导出、剪映草稿、去口癖等功能需要安装下面的依赖。

### 方式二：开发者本地运行

先克隆项目：

```bash
git clone https://github.com/sunxiaoqiqi/luyin.git
cd luyin
```

安装前端依赖：

```bash
npm.cmd install
```

启动应用：

```bash
npm.cmd start
```

## 依赖安装

### 1. 安装 Node.js

开发者本地运行源码时需要 Node.js。普通用户只运行打包后的 exe 时，一般不需要单独安装 Node.js。

推荐安装 Node.js LTS 版本：

- 官网：https://nodejs.org/
- Windows 也可以使用 winget：

```powershell
winget install OpenJS.NodeJS.LTS
```

安装后检查：

```powershell
node -v
npm -v
```

### 2. 安装 ffmpeg

以下功能需要 ffmpeg / ffprobe：

- 多段视频合并导出。
- 视频转码。
- 剪映草稿生成前的素材兼容处理。
- 去口癖流程中的音视频处理。

推荐安装方式：

```powershell
winget install Gyan.FFmpeg
```

如果 winget 安装后命令行仍然找不到 `ffmpeg`，请重启终端或电脑。

检查是否安装成功：

```powershell
ffmpeg -version
ffprobe -version
```

如果你不用 winget，也可以手动下载 ffmpeg，并把 `ffmpeg.exe` 和 `ffprobe.exe` 所在目录加入系统环境变量 `Path`。

### 3. 安装 Python

以下功能需要 Python：

- 生成剪映草稿。
- 去口癖生成草稿。

推荐安装 Python 3.10 或更高版本：

- 官网：https://www.python.org/downloads/windows/
- Windows 也可以使用 winget：

```powershell
winget install Python.Python.3.12
```

安装后检查：

```powershell
python --version
```

如果提示找不到 `python`，请确认安装 Python 时勾选了 `Add Python to PATH`，或者手动把 Python 加入系统环境变量 `Path`。

### 4. 安装剪映专业版

如果你需要“生成剪映草稿”，需要电脑上已经安装剪映专业版，并确认草稿目录可用。

简录制器默认剪映草稿目录：

```text
D:\剪映输出物\JianyingPro Drafts
```

你也可以在软件设置里改成自己的剪映草稿目录。常见目录类似：

```text
C:\Users\你的用户名\Documents\JianyingPro Drafts
```

或者：

```text
D:\剪映输出物\JianyingPro Drafts
```

## 第一次运行建议

1. 打开软件后，先进入设置。
2. 设置默认保存目录。
3. 设置剪映草稿目录。
4. 选择默认音频模式。
5. 如果需要点击缩放关键帧，再开启事件记录。
6. 回到主界面，选择录制源和录制范围。
7. 点击开始录制。

## 常见问题

### 提示找不到 ffmpeg

说明电脑没有安装 ffmpeg，或者 ffmpeg 没有加入系统环境变量 `Path`。

解决方式：

```powershell
winget install Gyan.FFmpeg
```

安装后重新打开终端或重启电脑，再执行：

```powershell
ffmpeg -version
```

### 提示找不到 Python

说明电脑没有安装 Python，或者 Python 没有加入系统环境变量 `Path`。

解决方式：

```powershell
winget install Python.Python.3.12
```

安装后检查：

```powershell
python --version
```

### 克隆后无法运行 npm

说明电脑没有安装 Node.js。

解决方式：

```powershell
winget install OpenJS.NodeJS.LTS
```

安装后重新打开终端，再执行：

```powershell
node -v
npm -v
```

### 剪映草稿生成到了错误的位置

请在设置里确认“剪映草稿目录”是否正确。这个目录应该是剪映专业版实际读取草稿的目录。

### 去口癖功能不能用

请先确认：

- 已安装 Python。
- 已安装 ffmpeg / ffprobe。
- 视频里有音频流。

如果视频没有音频流，去口癖检测会跳过。

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

## 开发状态

当前版本已经可以试用，但仍然是早期版本。后续计划：

- 增加正式安装包打包配置。
- 去口癖流程增加“只分析并预览剪辑点”模式。
- 增加剪辑点人工确认能力。
- 减少对用户本机 Python / ffmpeg 环境的依赖。
