const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

let mainWindow = null;
let isQuitting = false;
const childProcesses = new Set();
function getProductPath(...parts) {
  const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
  return path.join(root, ...parts);
}

function getMaterialEditorScript() {
  return getProductPath("vendor", "1-2-_capabilities-jianying-draft-tools", "scripts", "material_editor.py");
}

function getVerbalCleanerScript() {
  return getProductPath("vendor", "27-_workflows-verbal-cleaner", "scripts", "verbal_cleaner_workflow.py");
}

function getVerbalCleanerRunner() {
  return getProductPath("tools", "verbal_cleaner_runner.py");
}

function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function getDefaultDraftDir() {
  return "D:\\剪映输出物\\JianyingPro Drafts";
}

function getDefaultSettings() {
  return {
    saveDir: path.join(app.getPath("videos"), "简录制器"),
    draftDir: getDefaultDraftDir(),
    mode: "multi",
    defaultModeMigrated: true,
    recordClicksDefaultMigrated: true,
    sourceId: "",
    sourceName: "",
    audioMode: "system-mic",
    quality: "1080p-30",
    capturePreset: "16:9",
    cropOffset: {
      x: 0.5,
      y: 0.5
    },
    customArea: {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080
    },
    recordClicks: false,
    recordMousePath: false
  };
}

function readSettings() {
  const defaults = getDefaultSettings();
  try {
    const file = getSettingsPath();
    if (!fs.existsSync(file)) return defaults;
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    const oldDefaultDraftDir = path.join(app.getPath("documents"), "JianyingPro Drafts");
    if (!parsed.draftDir || parsed.draftDir === oldDefaultDraftDir) {
      parsed.draftDir = getDefaultDraftDir();
    }
    if (!parsed.defaultModeMigrated) {
      parsed.mode = "multi";
      parsed.defaultModeMigrated = true;
    }
    if (!parsed.recordClicksDefaultMigrated) {
      parsed.recordClicks = false;
      parsed.recordClicksDefaultMigrated = true;
    }
    return {
      ...defaults,
      ...parsed,
      cropOffset: { ...defaults.cropOffset, ...(parsed.cropOffset || {}) },
      customArea: { ...defaults.customArea, ...(parsed.customArea || {}) }
    };
  } catch {
    return defaults;
  }
}

function writeSettings(settings) {
  const settingsPath = getSettingsPath();
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#f7f7f8",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.on("close", () => {
    isQuitting = true;
    cleanupChildProcesses();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function cleanupChildProcesses() {
  for (const child of Array.from(childProcesses)) {
    try {
      if (!child.killed) child.kill("SIGTERM");
    } catch {
      // Ignore cleanup errors during shutdown.
    }
    childProcesses.delete(child);
  }
}

function ensureDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sanitizeFileName(name) {
  return String(name || "recording")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .trim()
    .slice(0, 120) || "recording";
}

function makeProjectDir(settings, projectName) {
  const safeName = sanitizeFileName(projectName || "未命名项目");
  return path.join(settings.saveDir, safeName);
}

function getFileStats(filePath) {
  const stats = fs.statSync(filePath);
  return {
    size: stats.size,
    sizeMb: Number((stats.size / 1024 / 1024).toFixed(2)),
    createdAt: stats.birthtime.toISOString(),
    modifiedAt: stats.mtime.toISOString()
  };
}

function getUniqueFilePath(dir, fileName) {
  const parsed = path.parse(fileName);
  let candidate = path.join(dir, fileName);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${parsed.name}_${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

async function probeVideoDuration(filePath) {
  const result = await runTracked("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath
  ]);

  if (!result.success) return 0;
  const duration = Number(String(result.stdout).trim());
  return Number.isFinite(duration) ? duration : 0;
}

function formatStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function secondsToSrtTime(seconds) {
  const totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  const pad = (value, len = 2) => String(value).padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function escapeConcatPath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/'/g, "'\\''");
}

function runTracked(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      ...options,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        ...(options.env || {})
      }
    });

    childProcesses.add(child);

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      childProcesses.delete(child);
      resolve({ success: false, code: -1, stdout, stderr: stderr || error.message });
    });

    child.on("close", (code) => {
      childProcesses.delete(child);
      resolve({ success: code === 0, code, stdout, stderr });
    });
  });
}

function getProjectPaths(projectName) {
  const settings = readSettings();
  const projectDir = makeProjectDir(settings, projectName);
  return {
    settings,
    projectDir,
    recordingsDir: path.join(projectDir, "recordings"),
    exportsDir: path.join(projectDir, "exports"),
    draftsDir: path.join(projectDir, "drafts")
  };
}

async function mergeProjectSegments(project, outputPrefix = "final") {
  const { projectDir, exportsDir } = getProjectPaths(project.name);
  ensureDirectory(exportsDir);

  const segments = (project.segments || [])
    .filter((segment) => segment.status !== "discarded" && segment.filePath && fs.existsSync(segment.filePath))
    .sort((a, b) => a.order - b.order);

  if (segments.length === 0) {
    return { success: false, error: "没有可合并的片段。" };
  }

  const listPath = path.join(exportsDir, `concat_${formatStamp()}.txt`);
  const outputPath = path.join(exportsDir, `${outputPrefix}_${formatStamp()}.mp4`);
  const listContent = segments.map((segment) => `file '${escapeConcatPath(segment.filePath)}'`).join("\n");
  fs.writeFileSync(listPath, listContent, "utf-8");

  const args = [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-movflags", "+faststart",
    outputPath
  ];

  const result = await runTracked("ffmpeg", args, { cwd: projectDir });

  try {
    fs.unlinkSync(listPath);
  } catch {
    // Keep going if cleanup fails.
  }

  if (!result.success) {
    return {
      success: false,
      error: result.stderr || result.stdout || "ffmpeg 合并失败。",
      outputPath
    };
  }

  return {
    success: true,
    outputPath,
    ...getFileStats(outputPath)
  };
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function normalizeClipPoints(clipPoints, duration) {
  return (clipPoints || [])
    .map((clip) => ({
      ...clip,
      start: clampNumber(clip.start, 0, duration),
      end: clampNumber(clip.end, 0, duration)
    }))
    .filter((clip) => clip.end - clip.start > 0.01)
    .sort((a, b) => a.start - b.start);
}

function getKeptRanges(duration, clipPoints) {
  const clips = normalizeClipPoints(clipPoints, duration);
  const ranges = [];
  let cursor = 0;

  for (const clip of clips) {
    if (clip.start > cursor + 0.05) {
      ranges.push({ start: cursor, end: clip.start });
    }
    cursor = Math.max(cursor, clip.end);
  }

  if (duration > cursor + 0.05) {
    ranges.push({ start: cursor, end: duration });
  }

  if (ranges.length === 0 && duration > 0.05) {
    ranges.push({ start: 0, end: duration });
  }

  return ranges;
}

function readEvents(eventsPath) {
  if (!eventsPath || !fs.existsSync(eventsPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(eventsPath, "utf-8"));
  } catch {
    return null;
  }
}

function writeRangeEvents(sourceEvents, range, outputPath, videoFileName) {
  if (!sourceEvents) return null;
  const events = Array.isArray(sourceEvents) ? sourceEvents : (sourceEvents.events || []);
  const mousePath = Array.isArray(sourceEvents.mouse_path) ? sourceEvents.mouse_path : [];
  const inRange = (event) => {
    const time = Number(event.time);
    return Number.isFinite(time) && time >= range.start && time <= range.end;
  };
  const remap = (event) => ({
    ...event,
    time: Math.max(0, Number(event.time) - range.start)
  });
  const nextEvents = events.filter(inRange).map(remap);
  const nextMousePath = mousePath.filter(inRange).map(remap);
  if (nextEvents.length === 0 && nextMousePath.length === 0) return null;

  const data = Array.isArray(sourceEvents)
    ? nextEvents
    : {
      ...sourceEvents,
      video_file: videoFileName,
      events: nextEvents,
      mouse_path: nextMousePath
    };
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf-8");
  return outputPath;
}

async function cutVideoRange(sourcePath, outputPath, start, duration, cwd) {
  const args = [
    "-y",
    "-ss", String(Math.max(0, start)),
    "-i", sourcePath,
    "-t", String(Math.max(0.05, duration)),
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-movflags", "+faststart",
    outputPath
  ];
  return runTracked("ffmpeg", args, { cwd });
}

async function runLimited(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function buildJianyingConfig(project) {
  const captureArea = project.captureArea || {};
  let cursor = 0;
  const associations = (project.segments || [])
    .filter((segment) => segment.status !== "discarded" && (segment.filePath || segment.file))
    .sort((a, b) => a.order - b.order)
    .map((segment, index) => {
      const duration = Math.max(0.1, Number(segment.duration || segment.trim?.out || 1));
      const start = cursor;
      const end = cursor + duration;
      cursor = end;

      return {
        subtitle_id: index + 1,
        subtitle_text: " ",
        subtitle_start: secondsToSrtTime(start),
        subtitle_end: secondsToSrtTime(end),
        subtitle_duration: duration,
        materials: [
          {
            file: path.basename(segment.filePath || segment.file || ""),
            type: "video",
            events_json: segment.eventsJson || null,
            layout: {
              mode: "single",
              position: "fullscreen"
            }
          }
        ]
      };
    });

  return {
    project_name: project.name,
    resolution: {
      width: captureArea.outputWidth || captureArea.width || 1920,
      height: captureArea.outputHeight || captureArea.height || 1080
    },
    fps: project.fps || 30,
    materials_folder: "../recordings",
    associations,
    default_effects: {
      transition: "none",
      subtitle_style: {
        size: 1,
        color: "#FFFFFF",
        border_width: 0,
        anim_in: ""
      }
    }
  };
}

async function ensureDraftCompatibleVideos(project, recordingsDir) {
  const clonedProject = {
    ...project,
    segments: []
  };
  ensureDirectory(recordingsDir);

  for (const segment of project.segments || []) {
    const sourcePath = segment.filePath || segment.file;
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      clonedProject.segments.push(segment);
      continue;
    }

    const sourceExt = path.extname(sourcePath).toLowerCase();
    const isInRecordingsDir = path.resolve(path.dirname(sourcePath)).toLowerCase() === path.resolve(recordingsDir).toLowerCase();
    let outputPath = sourcePath;

    if (sourceExt === ".mp4" && !isInRecordingsDir) {
      outputPath = getUniqueFilePath(recordingsDir, path.basename(sourcePath));
      fs.copyFileSync(sourcePath, outputPath);
    }

    if (sourceExt !== ".mp4") {
      outputPath = path.join(recordingsDir, `${path.basename(sourcePath, path.extname(sourcePath))}_draft.mp4`);

      if (!fs.existsSync(outputPath)) {
        const result = await runTracked("ffmpeg", [
          "-y",
          "-i", sourcePath,
          "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-pix_fmt", "yuv420p",
          "-c:a", "aac",
          "-movflags", "+faststart",
          outputPath
        ], { cwd: path.dirname(sourcePath) });

        if (!result.success) {
          throw new Error(result.stderr || result.stdout || `转码失败：${sourcePath}`);
        }
      }
    }

    let eventsJson = segment.eventsJson || null;
    let eventsJsonPath = segment.eventsJsonPath || null;
    if (eventsJsonPath && fs.existsSync(eventsJsonPath) && path.resolve(path.dirname(eventsJsonPath)).toLowerCase() !== path.resolve(recordingsDir).toLowerCase()) {
      const copiedEventsPath = getUniqueFilePath(recordingsDir, path.basename(eventsJsonPath));
      fs.copyFileSync(eventsJsonPath, copiedEventsPath);
      eventsJson = path.basename(copiedEventsPath);
      eventsJsonPath = copiedEventsPath;
    }

    clonedProject.segments.push({
      ...segment,
      filePath: outputPath,
      file: path.relative(makeProjectDir(readSettings(), project.name), outputPath).replace(/\\/g, "/"),
      eventsJson,
      eventsJsonPath
    });
  }

  return clonedProject;
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  cleanupChildProcesses();
});

app.on("will-quit", () => {
  cleanupChildProcesses();
  ipcMain.removeAllListeners();
});

ipcMain.handle("settings:get", () => readSettings());

ipcMain.handle("settings:save", (_event, nextSettings) => {
  const settings = { ...readSettings(), ...(nextSettings || {}) };
  writeSettings(settings);
  return settings;
});

ipcMain.handle("dialog:select-folder", async (_event, title = "选择文件夹") => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title,
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("sources:list", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 420, height: 260 },
    fetchWindowIcons: true
  });

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : "",
    appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : ""
  }));
});

ipcMain.handle("recording:save", (_event, payload) => {
  const settings = readSettings();
  const buffer = Buffer.from(payload.arrayBuffer);
  const extension = payload.extension || "webm";
  let targetDir = settings.saveDir;

  if (payload.mode === "multi") {
    targetDir = path.join(makeProjectDir(settings, payload.projectName), "recordings");
  }

  ensureDirectory(targetDir);

  const fileName = `${sanitizeFileName(payload.baseName)}.${extension}`;
  const filePath = path.join(targetDir, fileName);
  fs.writeFileSync(filePath, buffer);

  return {
    filePath,
    fileName,
    relativePath: payload.mode === "multi" ? path.relative(makeProjectDir(settings, payload.projectName), filePath).replace(/\\/g, "/") : fileName,
    ...getFileStats(filePath)
  };
});

ipcMain.handle("events:save", (_event, payload) => {
  const settings = readSettings();
  let targetDir = settings.saveDir;

  if (payload.mode === "multi") {
    targetDir = path.join(makeProjectDir(settings, payload.projectName), "recordings");
  }

  ensureDirectory(targetDir);

  const fileName = `${sanitizeFileName(payload.baseName)}_events.json`;
  const filePath = path.join(targetDir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(payload.eventsData || {}, null, 2), "utf-8");

  return {
    filePath,
    fileName,
    relativePath: payload.mode === "multi" ? path.relative(makeProjectDir(settings, payload.projectName), filePath).replace(/\\/g, "/") : fileName,
    ...getFileStats(filePath)
  };
});

ipcMain.handle("folder:scan-videos", async (_event, folderPath) => {
  if (!folderPath || !fs.existsSync(folderPath)) {
    return { success: false, error: "文件夹不存在。" };
  }

  const stat = fs.statSync(folderPath);
  if (!stat.isDirectory()) {
    return { success: false, error: "请选择文件夹。" };
  }

  const videoExtensions = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"]);
  const files = fs.readdirSync(folderPath)
    .filter((fileName) => videoExtensions.has(path.extname(fileName).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));

  const segments = [];
  for (let index = 0; index < files.length; index += 1) {
    const fileName = files[index];
    const filePath = path.join(folderPath, fileName);
    const parsed = path.parse(fileName);
    const eventsPath = path.join(folderPath, `${parsed.name}_events.json`);
    const duration = await probeVideoDuration(filePath);

    segments.push({
      id: `import_${Date.now()}_${index + 1}`,
      title: parsed.name,
      order: index + 1,
      file: fileName,
      filePath,
      duration: Math.round(duration * 1000) / 1000,
      sizeMb: getFileStats(filePath).sizeMb,
      eventsJson: fs.existsSync(eventsPath) ? path.basename(eventsPath) : null,
      eventsJsonPath: fs.existsSync(eventsPath) ? eventsPath : null,
      status: "confirmed",
      source: "folder",
      trim: {
        in: 0,
        out: Math.round(duration * 1000) / 1000
      }
    });
  }

  return {
    success: true,
    folderPath,
    segments
  };
});

ipcMain.handle("project:save", (_event, project) => {
  const settings = readSettings();
  const projectDir = makeProjectDir(settings, project.name);
  ensureDirectory(projectDir);
  const filePath = path.join(projectDir, "project.json");
  fs.writeFileSync(filePath, JSON.stringify(project, null, 2), "utf-8");
  return { filePath };
});

ipcMain.handle("draft:generate-config", (_event, project) => {
  const { projectDir, draftsDir } = getProjectPaths(project.name);
  ensureDirectory(draftsDir);

  const config = buildJianyingConfig(project);
  const configPath = path.join(draftsDir, "jianying_project_config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  return { configPath, projectDir };
});

ipcMain.handle("segments:merge", async (_event, project) => {
  const { projectDir, exportsDir } = getProjectPaths(project.name);
  ensureDirectory(exportsDir);

  const segments = (project.segments || [])
    .filter((segment) => segment.status !== "discarded" && segment.filePath && fs.existsSync(segment.filePath))
    .sort((a, b) => a.order - b.order);

  if (segments.length === 0) {
    return { success: false, error: "没有可合并的片段。" };
  }

  const listPath = path.join(exportsDir, `concat_${formatStamp()}.txt`);
  const outputPath = path.join(exportsDir, `final_${formatStamp()}.mp4`);
  const listContent = segments.map((segment) => `file '${escapeConcatPath(segment.filePath)}'`).join("\n");
  fs.writeFileSync(listPath, listContent, "utf-8");

  const args = [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-movflags", "+faststart",
    outputPath
  ];

  const result = await runTracked("ffmpeg", args, { cwd: projectDir });

  try {
    fs.unlinkSync(listPath);
  } catch {
    // Keep going if cleanup fails.
  }

  if (!result.success) {
    return {
      success: false,
      error: result.stderr || result.stdout || "ffmpeg 合并失败。",
      outputPath
    };
  }

  return {
    success: true,
    outputPath,
    ...getFileStats(outputPath)
  };
});

ipcMain.handle("draft:generate", async (_event, project) => {
  const { settings, projectDir, recordingsDir, draftsDir } = getProjectPaths(project.name);
  ensureDirectory(draftsDir);
  ensureDirectory(settings.draftDir);

  let draftProject = project;
  try {
    draftProject = await ensureDraftCompatibleVideos(project, recordingsDir);
  } catch (error) {
    const logPath = path.join(draftsDir, "generate.log");
    fs.writeFileSync(logPath, error.message || String(error), "utf-8");
    return {
      success: false,
      logPath,
      error: error.message || String(error)
    };
  }

  const config = buildJianyingConfig(draftProject);
  const configPath = path.join(draftsDir, "jianying_project_config.json");
  const logPath = path.join(draftsDir, "generate.log");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

  const materialEditorScript = getMaterialEditorScript();
  if (!fs.existsSync(materialEditorScript)) {
    return {
      success: false,
      configPath,
      logPath,
      error: `找不到素材编排脚本：${materialEditorScript}`
    };
  }

  const result = await runTracked("python", [materialEditorScript, configPath], {
    cwd: path.dirname(materialEditorScript),
    env: {
      JIANYING_DRAFTS_ROOT: settings.draftDir
    }
  });

  fs.writeFileSync(logPath, `${result.stdout}\n${result.stderr}`, "utf-8");

  if (!result.success) {
    return {
      success: false,
      configPath,
      logPath,
      error: result.stderr || result.stdout || "剪映草稿生成失败。"
    };
  }

  return {
    success: true,
    configPath,
    logPath,
    projectDir,
    draftRoot: settings.draftDir,
    draftProjectPath: path.join(settings.draftDir, sanitizeFileName(project.name)),
    output: result.stdout
  };
});

ipcMain.handle("verbal-cleaner:generate-draft", async (_event, project) => {
  const { settings, projectDir, recordingsDir, draftsDir } = getProjectPaths(project.name);
  ensureDirectory(draftsDir);
  ensureDirectory(recordingsDir);
  ensureDirectory(settings.draftDir);

  const verbalCleanerScript = getVerbalCleanerScript();
  const verbalCleanerRunner = getVerbalCleanerRunner();
  const materialEditorScript = getMaterialEditorScript();
  if (!fs.existsSync(verbalCleanerScript)) {
    return { success: false, error: `找不到去口癖脚本：${verbalCleanerScript}` };
  }
  if (!fs.existsSync(verbalCleanerRunner)) {
    return { success: false, error: `找不到去口癖运行器：${verbalCleanerRunner}` };
  }
  if (!fs.existsSync(materialEditorScript)) {
    return { success: false, error: `找不到素材编排脚本：${materialEditorScript}` };
  }

  const segments = (project.segments || [])
    .filter((segment) => segment.status !== "discarded" && segment.filePath && fs.existsSync(segment.filePath))
    .sort((a, b) => a.order - b.order);
  if (segments.length === 0) {
    return { success: false, error: "没有可处理的片段。" };
  }

  const workDir = path.join(draftsDir, "verbal_cleaner");
  const analysisDir = path.join(workDir, "analysis");
  ensureDirectory(workDir);
  ensureDirectory(analysisDir);
  const logPath = path.join(workDir, "verbal_cleaner.log");
  const resultJsonPath = path.join(workDir, "verbal_cleaner_result.json");
  const configPath = path.join(workDir, "jianying_project_config.json");
  const logs = [];

  const analyses = await runLimited(segments, Number(settings.verbalCleanerConcurrency || 2), async (segment, index) => {
    const segmentId = `segment_${String(index + 1).padStart(3, "0")}`;
    const segmentAnalysisDir = path.join(analysisDir, segmentId);
    ensureDirectory(segmentAnalysisDir);
    const segmentResultPath = path.join(segmentAnalysisDir, "analysis.json");
    const result = await runTracked("python", [
      verbalCleanerRunner,
      "--mode", "analyze",
      "--script", verbalCleanerScript,
      "--video", segment.filePath,
      "--name", segmentId,
      "--model", settings.verbalCleanerModel || "base",
      "--min-duration", String(settings.verbalCleanerMinDuration || 0.2),
      "--output-dir", segmentAnalysisDir,
      "--result-json", segmentResultPath
    ], {
      cwd: projectDir,
      env: {
        JIANYING_DRAFTS_ROOT: settings.draftDir
      }
    });
    logs.push(`\n===== ${segmentId} ${path.basename(segment.filePath)} =====\n${result.stdout}\n${result.stderr}`);
    const analysis = fs.existsSync(segmentResultPath)
      ? JSON.parse(fs.readFileSync(segmentResultPath, "utf-8"))
      : { success: false, error: result.stderr || result.stdout || "分析失败。" };
    return { segment, index, segmentId, result, analysis };
  });

  fs.writeFileSync(logPath, logs.join("\n"), "utf-8");
  const failed = analyses.find((item) => !item.result.success || !item.analysis?.success);
  if (failed) {
    fs.writeFileSync(resultJsonPath, JSON.stringify({ success: false, analyses }, null, 2), "utf-8");
    return {
      success: false,
      error: failed.analysis?.error || failed.result.stderr || failed.result.stdout || "去口癖片段分析失败。",
      logPath,
      resultJsonPath
    };
  }

  const cleanSegments = [];
  let order = 1;
  for (const item of analyses) {
    const duration = Number(item.segment.duration || item.segment.trim?.out || 0);
    const keptRanges = getKeptRanges(duration, item.analysis.clip_points || []);
    const sourceEvents = readEvents(item.segment.eventsJsonPath);

    for (let rangeIndex = 0; rangeIndex < keptRanges.length; rangeIndex += 1) {
      const range = keptRanges[rangeIndex];
      const rangeDuration = range.end - range.start;
      if (rangeDuration < 0.05) continue;

      const baseName = `clean_${String(item.index + 1).padStart(3, "0")}_${String(rangeIndex + 1).padStart(3, "0")}`;
      const outputPath = path.join(recordingsDir, `${baseName}.mp4`);
      const cutResult = await cutVideoRange(item.segment.filePath, outputPath, range.start, rangeDuration, projectDir);
      logs.push(`\n===== cut ${baseName} =====\n${cutResult.stdout}\n${cutResult.stderr}`);
      if (!cutResult.success) {
        fs.writeFileSync(logPath, logs.join("\n"), "utf-8");
        return { success: false, error: cutResult.stderr || cutResult.stdout || "生成去口癖保留片段失败。", logPath };
      }

      const eventsFileName = `${baseName}_events.json`;
      const eventsPath = path.join(recordingsDir, eventsFileName);
      const writtenEvents = writeRangeEvents(sourceEvents, range, eventsPath, path.basename(outputPath));

      cleanSegments.push({
        id: baseName,
        title: `${item.segment.title || item.segmentId} ${rangeIndex + 1}`,
        order,
        file: path.basename(outputPath),
        filePath: outputPath,
        duration: Math.round(rangeDuration * 1000) / 1000,
        eventsJson: writtenEvents ? eventsFileName : null,
        eventsJsonPath: writtenEvents || null,
        status: "confirmed",
        sourceSegmentId: item.segment.id,
        sourceRange: range
      });
      order += 1;
    }
  }

  const draftName = `${sanitizeFileName(project.name || "未命名项目")}_去口癖`;
  const cleanProject = {
    ...project,
    name: draftName,
    segments: cleanSegments
  };
  const config = buildJianyingConfig(cleanProject);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

  const draftResult = await runTracked("python", [materialEditorScript, configPath], {
    cwd: path.dirname(materialEditorScript),
    env: {
      JIANYING_DRAFTS_ROOT: settings.draftDir
    }
  });
  logs.push(`\n===== material_editor =====\n${draftResult.stdout}\n${draftResult.stderr}`);
  fs.writeFileSync(logPath, logs.join("\n"), "utf-8");

  const workflowResult = {
    success: draftResult.success,
    total_clips: analyses.reduce((sum, item) => sum + Number(item.analysis.total_clips || 0), 0),
    removed_duration: analyses.reduce((sum, item) => sum + Number(item.analysis.removed_duration || 0), 0),
    analyzed_segments: analyses.length,
    generated_segments: cleanSegments.length,
    analyses: analyses.map((item) => ({
      segment_id: item.segment.id,
      segment_title: item.segment.title,
      result: item.analysis
    }))
  };
  fs.writeFileSync(resultJsonPath, JSON.stringify(workflowResult, null, 2), "utf-8");

  if (!draftResult.success) {
    return {
      success: false,
      error: draftResult.stderr || draftResult.stdout || "去口癖草稿生成失败。",
      logPath,
      resultJsonPath,
      configPath,
      workflowResult
    };
  }

  return {
    success: true,
    logPath,
    resultJsonPath,
    configPath,
    draftRoot: settings.draftDir,
    draftProjectPath: path.join(settings.draftDir, draftName),
    workflowResult
  };
});
ipcMain.handle("shell:open-path", async (_event, targetPath) => {
  if (!targetPath) return false;
  const stats = fs.existsSync(targetPath) ? fs.statSync(targetPath) : null;
  const openTarget = stats && stats.isFile() ? path.dirname(targetPath) : targetPath;
  await shell.openPath(openTarget);
  return true;
});

ipcMain.handle("app:cleanup-child-processes", () => {
  cleanupChildProcesses();
  return true;
});

ipcMain.handle("app:quit", () => {
  isQuitting = true;
  cleanupChildProcesses();
  app.quit();
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});


