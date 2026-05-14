const api = window.recorderApi;

const rangePresets = [
  { id: "16:9", title: "16:9", subtitle: "YouTube", ratio: 16 / 9 },
  { id: "4:3", title: "4:3", subtitle: "经典", ratio: 4 / 3 },
  { id: "3:4", title: "3:4", subtitle: "小红书", ratio: 3 / 4 },
  { id: "9:16", title: "9:16", subtitle: "抖音", ratio: 9 / 16 },
  { id: "1:1", title: "1:1", subtitle: "正方形", ratio: 1 },
  { id: "custom", title: "Custom", subtitle: "自定义", ratio: null }
];

const state = {
  settings: null,
  sources: [],
  mediaRecorder: null,
  chunks: [],
  clickEvents: [],
  mousePathEvents: [],
  rawStream: null,
  micStream: null,
  processedStream: null,
  drawFrameId: null,
  audioWarning: "",
  cropOffset: {
    x: 0.5,
    y: 0.5
  },
  cropDrag: null,
  sourceSize: {
    width: 1920,
    height: 1080
  },
  startedAt: 0,
  pausedAt: 0,
  pausedMs: 0,
  timerId: null,
  isRecording: false,
  isPaused: false,
  cancelRequested: false,
  segments: [],
  projectName: "",
  lastSavedPath: ""
};

const els = {
  statusText: document.getElementById("statusText"),
  modeSelect: document.getElementById("modeSelect"),
  sourceSelect: document.getElementById("sourceSelect"),
  audioSelect: document.getElementById("audioSelect"),
  qualitySelect: document.getElementById("qualitySelect"),
  saveDirText: document.getElementById("saveDirText"),
  chooseSaveDirBtn: document.getElementById("chooseSaveDirBtn"),
  openSaveDirBtn: document.getElementById("openSaveDirBtn"),
  refreshSourcesBtn: document.getElementById("refreshSourcesBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  rangePresets: document.getElementById("rangePresets"),
  customAreaForm: document.getElementById("customAreaForm"),
  customX: document.getElementById("customX"),
  customY: document.getElementById("customY"),
  customWidth: document.getElementById("customWidth"),
  customHeight: document.getElementById("customHeight"),
  setDefaultRangeBtn: document.getElementById("setDefaultRangeBtn"),
  sourceNameText: document.getElementById("sourceNameText"),
  sourceThumbnail: document.getElementById("sourceThumbnail"),
  previewVideo: document.getElementById("previewVideo"),
  cropFrame: document.getElementById("cropFrame"),
  cropLabel: document.querySelector("#cropFrame .crop-label"),
  recordCanvas: document.getElementById("recordCanvas"),
  timerText: document.getElementById("timerText"),
  startBtn: document.getElementById("startBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  stopBtn: document.getElementById("stopBtn"),
  cancelBtn: document.getElementById("cancelBtn"),
  projectNameInput: document.getElementById("projectNameInput"),
  projectSummary: document.getElementById("projectSummary"),
  segmentsList: document.getElementById("segmentsList"),
  importFolderBtn: document.getElementById("importFolderBtn"),
  mergeBtn: document.getElementById("mergeBtn"),
  draftBtn: document.getElementById("draftBtn"),
  cleanDraftBtn: document.getElementById("cleanDraftBtn"),
  resultDialog: document.getElementById("resultDialog"),
  resultTitle: document.getElementById("resultTitle"),
  resultBody: document.getElementById("resultBody"),
  resultOpenBtn: document.getElementById("resultOpenBtn"),
  settingsDialog: document.getElementById("settingsDialog"),
  settingsSaveDir: document.getElementById("settingsSaveDir"),
  settingsSaveDirBtn: document.getElementById("settingsSaveDirBtn"),
  settingsDraftDir: document.getElementById("settingsDraftDir"),
  settingsDraftDirBtn: document.getElementById("settingsDraftDirBtn"),
  settingsAudio: document.getElementById("settingsAudio"),
  settingsQuality: document.getElementById("settingsQuality"),
  settingsRecordClicks: document.getElementById("settingsRecordClicks"),
  settingsRecordMousePath: document.getElementById("settingsRecordMousePath"),
  settingsSaveBtn: document.getElementById("settingsSaveBtn")
};

function nowStamp() {
  const d = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function getElapsedMs() {
  if (!state.startedAt) return 0;
  const end = state.isPaused ? state.pausedAt : Date.now();
  return end - state.startedAt - state.pausedMs;
}

function getRecordingTimeSeconds() {
  return Math.round(getElapsedMs()) / 1000;
}

function getQuality() {
  const [size, fpsText] = els.qualitySelect.value.split("-");
  const fps = Number(fpsText || 30);
  const sizes = {
    "1080p": { width: 1920, height: 1080 },
    "720p": { width: 1280, height: 720 },
    original: { width: 1920, height: 1080 }
  };
  return { ...(sizes[size] || sizes["1080p"]), fps };
}

function getSelectedPreset() {
  return rangePresets.find((preset) => preset.id === state.settings.capturePreset) || rangePresets[0];
}

function getOutputSize(sourceWidth, sourceHeight) {
  const quality = getQuality();
  const preset = getSelectedPreset();

  if (preset.id === "custom") {
    return {
      width: Math.max(1, Number(els.customWidth.value || state.settings.customArea.width || quality.width)),
      height: Math.max(1, Number(els.customHeight.value || state.settings.customArea.height || quality.height))
    };
  }

  const ratio = preset.ratio;
  let width = quality.width;
  let height = Math.round(width / ratio);

  if (height > quality.height) {
    height = quality.height;
    width = Math.round(height * ratio);
  }

  const maxWidth = sourceWidth || width;
  const maxHeight = sourceHeight || height;
  return {
    width: Math.min(width, maxWidth),
    height: Math.min(height, maxHeight)
  };
}

function getCropRect(videoWidth, videoHeight, outputWidth, outputHeight) {
  const preset = getSelectedPreset();
  let sw = Math.min(Math.max(1, Number(els.customWidth.value || outputWidth)), videoWidth);
  let sh = Math.min(Math.max(1, Number(els.customHeight.value || outputHeight)), videoHeight);

  if (preset.id !== "custom") {
    sh = Math.round(sw / preset.ratio);
    if (sh > videoHeight) {
      sh = videoHeight;
      sw = Math.round(sh * preset.ratio);
    }
  }

  const sx = clamp(Number(els.customX.value || 0), 0, Math.max(0, videoWidth - sw));
  const sy = clamp(Number(els.customY.value || 0), 0, Math.max(0, videoHeight - sh));
  return {
    sx,
    sy,
    sw,
    sh
  };
}

function getPointerSourcePosition(event) {
  const preview = getPreviewSourceRect();
  const stageRect = els.cropFrame.parentElement.getBoundingClientRect();
  const x = clamp((event.clientX - stageRect.left - preview.left) / preview.scale, 0, preview.source.width);
  const y = clamp((event.clientY - stageRect.top - preview.top) / preview.scale, 0, preview.source.height);
  return {
    x: Math.round(x),
    y: Math.round(y)
  };
}

function getFallbackPointerSourcePosition(event) {
  const crop = getCropRect(state.sourceSize.width, state.sourceSize.height, state.sourceSize.width, state.sourceSize.height);
  const appX = clamp(event.clientX / Math.max(1, window.innerWidth), 0, 1);
  const appY = clamp(event.clientY / Math.max(1, window.innerHeight), 0, 1);
  return {
    x: Math.round(crop.sx + appX * crop.sw),
    y: Math.round(crop.sy + appY * crop.sh)
  };
}

function updateCropFrame() {
  const preset = getSelectedPreset();
  els.cropLabel.textContent = preset.title;
  els.customAreaForm.classList.remove("hidden");
  els.cropFrame.classList.add("custom-resize");
  normalizeCropInputsForPreset();
  syncFrameFromCustomArea();
  updateCropFramePosition();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getCurrentSourceSize() {
  return {
    width: els.previewVideo.videoWidth || state.sourceSize.width || 1920,
    height: els.previewVideo.videoHeight || state.sourceSize.height || 1080
  };
}

function setSourceSize(width, height, preserveCustomArea = true) {
  const nextWidth = Math.max(1, Math.round(width || 1920));
  const nextHeight = Math.max(1, Math.round(height || 1080));
  const prevWidth = state.sourceSize.width || nextWidth;
  const prevHeight = state.sourceSize.height || nextHeight;

  if (preserveCustomArea && (prevWidth !== nextWidth || prevHeight !== nextHeight)) {
    const scaleX = nextWidth / prevWidth;
    const scaleY = nextHeight / prevHeight;
    els.customX.value = Math.round(Number(els.customX.value || 0) * scaleX);
    els.customY.value = Math.round(Number(els.customY.value || 0) * scaleY);
    els.customWidth.value = Math.round(Number(els.customWidth.value || nextWidth) * scaleX);
    els.customHeight.value = Math.round(Number(els.customHeight.value || nextHeight) * scaleY);
  }

  state.sourceSize = {
    width: nextWidth,
    height: nextHeight
  };

  updateCropFramePosition();
}

function getPreviewSourceRect() {
  const stageRect = els.cropFrame.parentElement.getBoundingClientRect();
  const source = getCurrentSourceSize();
  const scale = Math.min(stageRect.width / source.width, stageRect.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  return {
    stageRect,
    source,
    scale,
    left: (stageRect.width - width) / 2,
    top: (stageRect.height - height) / 2,
    width,
    height
  };
}

function updateCropFramePosition() {
  const preview = getPreviewSourceRect();
  const crop = getCropRect(preview.source.width, preview.source.height, preview.source.width, preview.source.height);
  const left = preview.left + crop.sx * preview.scale;
  const top = preview.top + crop.sy * preview.scale;
  const width = crop.sw * preview.scale;
  const height = crop.sh * preview.scale;

  for (const media of [els.sourceThumbnail, els.previewVideo]) {
    media.style.width = `${preview.width}px`;
    media.style.height = `${preview.height}px`;
    media.style.left = `${preview.left}px`;
    media.style.top = `${preview.top}px`;
  }

  els.cropFrame.style.width = `${width}px`;
  els.cropFrame.style.height = `${height}px`;
  els.cropFrame.style.left = `${left}px`;
  els.cropFrame.style.top = `${top}px`;
  els.cropFrame.style.transform = "none";
}

function setSourceSizeFromThumbnail() {
  const naturalWidth = els.sourceThumbnail.naturalWidth || 0;
  const naturalHeight = els.sourceThumbnail.naturalHeight || 0;
  if (!naturalWidth || !naturalHeight) {
    updateCropFramePosition();
    return;
  }

  const baseWidth = 1920;
  const estimatedHeight = Math.round(baseWidth * naturalHeight / naturalWidth);
  setSourceSize(baseWidth, estimatedHeight, false);
}

function normalizeCropInputsForPreset() {
  const { width: sourceWidth, height: sourceHeight } = getCurrentSourceSize();
  const preset = getSelectedPreset();
  let width = Math.min(Math.max(1, Number(els.customWidth.value || sourceWidth)), sourceWidth);
  let height = Math.min(Math.max(1, Number(els.customHeight.value || sourceHeight)), sourceHeight);

  if (preset.id !== "custom") {
    height = Math.round(width / preset.ratio);
    if (height > sourceHeight) {
      height = sourceHeight;
      width = Math.round(height * preset.ratio);
    }
  }

  const x = clamp(Number(els.customX.value || 0), 0, Math.max(0, sourceWidth - width));
  const y = clamp(Number(els.customY.value || 0), 0, Math.max(0, sourceHeight - height));

  els.customX.value = Math.round(x);
  els.customY.value = Math.round(y);
  els.customWidth.value = Math.round(width);
  els.customHeight.value = Math.round(height);
}

function applyLockedRatioFromInput(input) {
  const preset = getSelectedPreset();
  if (preset.id === "custom") return;

  if (input === els.customHeight) {
    const height = Math.max(1, Number(els.customHeight.value || 1));
    els.customWidth.value = Math.round(height * preset.ratio);
    return;
  }

  if (input === els.customWidth) {
    const width = Math.max(1, Number(els.customWidth.value || 1));
    els.customHeight.value = Math.round(width / preset.ratio);
  }
}

function syncFrameFromCustomArea() {
  const { width: sourceWidth, height: sourceHeight } = getCurrentSourceSize();
  normalizeCropInputsForPreset();
  const width = Math.min(Number(els.customWidth.value || sourceWidth), sourceWidth);
  const height = Math.min(Number(els.customHeight.value || sourceHeight), sourceHeight);
  const maxX = Math.max(1, sourceWidth - width);
  const maxY = Math.max(1, sourceHeight - height);

  state.cropOffset.x = clamp(Number(els.customX.value || 0) / maxX, 0, 1);
  state.cropOffset.y = clamp(Number(els.customY.value || 0) / maxY, 0, 1);
  state.settings.cropOffset = { ...state.cropOffset };
  updateCropFramePosition();
}

function saveCropSettings() {
  state.settings.cropOffset = { ...state.cropOffset };
  state.settings.customArea = {
    x: Number(els.customX.value || 0),
    y: Number(els.customY.value || 0),
    width: Number(els.customWidth.value || 1920),
    height: Number(els.customHeight.value || 1080)
  };
  api.saveSettings({
    cropOffset: state.settings.cropOffset,
    customArea: state.settings.customArea
  });
}

function buildEventsData(videoFileName) {
  const source = getCurrentSourceSize();
  const crop = getCropRect(source.width, source.height, source.width, source.height);
  const normalizeEvent = (event) => ({
    ...event,
    x: crop.sw > 0 ? clamp((event.x - crop.sx) / crop.sw, 0, 1) : 0.5,
    y: crop.sh > 0 ? clamp((event.y - crop.sy) / crop.sh, 0, 1) : 0.5,
    source_x: event.x,
    source_y: event.y
  });

  return {
    version: "1.0",
    video_file: videoFileName,
    screen: {
      width: source.width,
      height: source.height
    },
    capture_area: {
      preset: state.settings.capturePreset,
      x: Math.round(crop.sx),
      y: Math.round(crop.sy),
      width: Math.round(crop.sw),
      height: Math.round(crop.sh)
    },
    events: state.clickEvents.map(normalizeEvent),
    mouse_path: state.settings.recordMousePath ? state.mousePathEvents.map(normalizeEvent) : []
  };
}

async function saveEventsForRecording(baseName, mode, projectName, videoFileName) {
  if (!state.settings.recordClicks && !state.settings.recordMousePath) return null;

  const eventsData = buildEventsData(videoFileName);
  const result = await api.saveEvents({
    baseName,
    mode,
    projectName,
    eventsData
  });
  return result;
}

function moveCropBySourceDelta(dx, dy) {
  const source = getCurrentSourceSize();
  const width = Math.min(Number(els.customWidth.value || source.width), source.width);
  const height = Math.min(Number(els.customHeight.value || source.height), source.height);
  const maxX = Math.max(0, source.width - width);
  const maxY = Math.max(0, source.height - height);
  const nextX = clamp(Number(els.customX.value || 0) + dx, 0, maxX);
  const nextY = clamp(Number(els.customY.value || 0) + dy, 0, maxY);
  els.customX.value = Math.round(nextX);
  els.customY.value = Math.round(nextY);
  syncFrameFromCustomArea();
}

function resizeCustomCropFromPointer(event) {
  const drag = state.cropDrag;
  if (!drag || drag.mode !== "resize") return;

  const source = getCurrentSourceSize();
  const dx = (event.clientX - drag.startX) / drag.preview.scale;
  const dy = (event.clientY - drag.startY) / drag.preview.scale;
  let { x, y, width, height } = drag.startCustom;
  const minSize = 80;
  const preset = getSelectedPreset();

  if (preset.id !== "custom") {
    const candidates = [];
    if (drag.corner.includes("e")) candidates.push(dx);
    if (drag.corner.includes("w")) candidates.push(-dx);
    if (drag.corner.includes("s")) candidates.push(dy * preset.ratio);
    if (drag.corner.includes("n")) candidates.push(-dy * preset.ratio);
    const widthDelta = candidates.reduce((best, value) => Math.abs(value) > Math.abs(best) ? value : best, 0);
    let nextWidth = clamp(width + widthDelta, minSize, source.width);
    let nextHeight = Math.round(nextWidth / preset.ratio);

    if (nextHeight > source.height) {
      nextHeight = source.height;
      nextWidth = Math.round(nextHeight * preset.ratio);
    }

    if (drag.corner.includes("w")) x = x + (width - nextWidth);
    if (drag.corner.includes("n")) y = y + (height - nextHeight);
    width = nextWidth;
    height = nextHeight;
    x = clamp(x, 0, Math.max(0, source.width - width));
    y = clamp(y, 0, Math.max(0, source.height - height));

    els.customX.value = Math.round(x);
    els.customY.value = Math.round(y);
    els.customWidth.value = Math.round(width);
    els.customHeight.value = Math.round(height);
    syncFrameFromCustomArea();
    return;
  }

  if (drag.corner.includes("e")) {
    width = clamp(width + dx, minSize, source.width - x);
  }
  if (drag.corner.includes("s")) {
    height = clamp(height + dy, minSize, source.height - y);
  }
  if (drag.corner.includes("w")) {
    const nextX = clamp(x + dx, 0, x + width - minSize);
    width = width + (x - nextX);
    x = nextX;
  }
  if (drag.corner.includes("n")) {
    const nextY = clamp(y + dy, 0, y + height - minSize);
    height = height + (y - nextY);
    y = nextY;
  }

  els.customX.value = Math.round(x);
  els.customY.value = Math.round(y);
  els.customWidth.value = Math.round(width);
  els.customHeight.value = Math.round(height);
  syncFrameFromCustomArea();
}

function bindCropDragging() {
  els.cropFrame.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    els.cropFrame.setPointerCapture(event.pointerId);
    const resizeHandle = event.target.closest("[data-resize]");
    const preview = getPreviewSourceRect();
    const custom = {
      x: Number(els.customX.value || 0),
      y: Number(els.customY.value || 0),
      width: Number(els.customWidth.value || preview.source.width),
      height: Number(els.customHeight.value || preview.source.height)
    };
    state.cropDrag = {
      mode: resizeHandle ? "resize" : "move",
      corner: resizeHandle ? resizeHandle.dataset.resize : "",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
      startOffsetX: state.cropOffset.x,
      startOffsetY: state.cropOffset.y,
      preview,
      startCustom: custom
    };
  });

  els.cropFrame.addEventListener("pointermove", (event) => {
    if (!state.cropDrag || state.cropDrag.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - state.cropDrag.startX) > 4 || Math.abs(event.clientY - state.cropDrag.startY) > 4) {
      state.cropDrag.moved = true;
    }

    if (state.cropDrag.mode === "resize") {
      resizeCustomCropFromPointer(event);
      updateCropFramePosition();
      return;
    }

    const dx = (event.clientX - state.cropDrag.lastX) / state.cropDrag.preview.scale;
    const dy = (event.clientY - state.cropDrag.lastY) / state.cropDrag.preview.scale;
    state.cropDrag.lastX = event.clientX;
    state.cropDrag.lastY = event.clientY;
    moveCropBySourceDelta(dx, dy);
    updateCropFramePosition();
  });

  els.cropFrame.addEventListener("pointerup", (event) => {
    if (!state.cropDrag || state.cropDrag.pointerId !== event.pointerId) return;
    const wasClick = state.cropDrag.mode === "move" && !state.cropDrag.moved;
    normalizeCropInputsForPreset();
    syncFrameFromCustomArea();
    saveCropSettings();
    if (wasClick) {
      recordPointerEvent("click", event);
    }
    try {
      els.cropFrame.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
    state.cropDrag = null;
  });

  els.cropFrame.addEventListener("pointercancel", () => {
    state.cropDrag = null;
  });
}

function renderRangePresets() {
  els.rangePresets.innerHTML = "";
  for (const preset of rangePresets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `range-card${state.settings.capturePreset === preset.id ? " active" : ""}`;
    button.dataset.preset = preset.id;
    button.innerHTML = `<strong>${preset.title}</strong><span>${preset.subtitle}</span>`;
    button.addEventListener("click", () => {
      state.settings.capturePreset = preset.id;
      api.saveSettings({ capturePreset: preset.id, cropOffset: state.cropOffset });
      renderRangePresets();
      updateCropFrame();
    });
    els.rangePresets.appendChild(button);
  }
  updateCropFrame();
}

function setRecordingUi(recording, paused = false) {
  state.isRecording = recording;
  state.isPaused = paused;
  els.startBtn.disabled = recording;
  els.pauseBtn.disabled = !recording;
  els.stopBtn.disabled = !recording;
  els.cancelBtn.disabled = !recording;
  els.pauseBtn.textContent = paused ? "继续" : "暂停";
  els.statusText.textContent = recording ? (paused ? "录制已暂停" : "正在录制") : "准备录制";
}

function startTimer() {
  clearInterval(state.timerId);
  state.timerId = setInterval(() => {
    els.timerText.textContent = formatDuration(getElapsedMs());
  }, 250);
}

function stopTimer() {
  clearInterval(state.timerId);
  state.timerId = null;
  els.timerText.textContent = formatDuration(getElapsedMs());
}

function stopStream(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

function cleanupRecordingRuntime() {
  if (state.drawFrameId) cancelAnimationFrame(state.drawFrameId);
  state.drawFrameId = null;
  stopStream(state.rawStream);
  stopStream(state.micStream);
  stopStream(state.processedStream);
  state.rawStream = null;
  state.micStream = null;
  state.processedStream = null;
  els.previewVideo.srcObject = null;
  els.previewVideo.style.display = "none";
  els.sourceThumbnail.style.display = "block";
}

function getSupportedMime() {
  const candidates = [
    "video/mp4;codecs=h264,aac",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function extensionFromMime(mime) {
  return mime.includes("mp4") ? "mp4" : "webm";
}

async function getDesktopStream(sourceId, useSystemAudio) {
  return navigator.mediaDevices.getUserMedia({
    audio: useSystemAudio
      ? {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: sourceId
          }
        }
      : false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        maxFrameRate: getQuality().fps
      }
    }
  });
}

async function getDesktopStreamWithFallback(sourceId, useSystemAudio) {
  state.audioWarning = "";

  if (!useSystemAudio) {
    return getDesktopStream(sourceId, false);
  }

  try {
    return await getDesktopStream(sourceId, true);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    state.audioWarning = `系统声音未能启动，已自动降级为继续录制画面${els.audioSelect.value === "system-mic" ? "和麦克风" : ""}。原始错误：${message}`;
    return getDesktopStream(sourceId, false);
  }
}

async function getMicStream() {
  return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
}

async function getMicStreamWithFallback() {
  try {
    return await getMicStream();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    const prefix = state.audioWarning ? `${state.audioWarning}\n` : "";
    state.audioWarning = `${prefix}麦克风未能启动，已继续录制可用的画面/声音。原始错误：${message}`;
    return null;
  }
}

async function createProcessedStream(rawStream) {
  const video = els.previewVideo;
  video.srcObject = rawStream;
  video.muted = true;
  video.style.display = "block";
  els.sourceThumbnail.style.display = "none";

  await new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      setSourceSize(video.videoWidth || 1920, video.videoHeight || 1080, true);
      resolve();
    };
  });

  const sourceWidth = video.videoWidth || 1920;
  const sourceHeight = video.videoHeight || 1080;
  const output = getOutputSize(sourceWidth, sourceHeight);
  const canvas = els.recordCanvas;
  canvas.width = output.width;
  canvas.height = output.height;
  const ctx = canvas.getContext("2d", { alpha: false });

  const draw = () => {
    const rect = getCropRect(video.videoWidth || sourceWidth, video.videoHeight || sourceHeight, canvas.width, canvas.height);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, canvas.width, canvas.height);
    state.drawFrameId = requestAnimationFrame(draw);
  };
  draw();

  return canvas.captureStream(getQuality().fps);
}

async function startRecording() {
  const sourceId = els.sourceSelect.value;
  if (!sourceId) {
    showResult("无法开始录制", "请先选择一个录制源。");
    return;
  }

  state.cancelRequested = false;
  state.chunks = [];
  state.clickEvents = [];
  state.mousePathEvents = [];

  const audioMode = els.audioSelect.value;
  const useSystemAudio = audioMode === "system" || audioMode === "system-mic";
  const useMic = audioMode === "mic" || audioMode === "system-mic";

  try {
    state.rawStream = await getDesktopStreamWithFallback(sourceId, useSystemAudio);
    const videoStream = await createProcessedStream(state.rawStream);
    state.processedStream = new MediaStream(videoStream.getVideoTracks());
    saveCropSettings();

    for (const track of state.rawStream.getAudioTracks()) {
      state.processedStream.addTrack(track);
    }

    if (useMic) {
      state.micStream = await getMicStreamWithFallback();
      if (state.micStream) {
        for (const track of state.micStream.getAudioTracks()) {
          state.processedStream.addTrack(track);
        }
      }
    }

    const mimeType = getSupportedMime();
    state.mediaRecorder = new MediaRecorder(state.processedStream, mimeType ? { mimeType } : undefined);
    state.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) state.chunks.push(event.data);
    };
    state.mediaRecorder.onstop = () => finishRecording(mimeType);

    state.startedAt = Date.now();
    state.pausedAt = 0;
    state.pausedMs = 0;
    state.mediaRecorder.start(1000);
    setRecordingUi(true);
    if (state.audioWarning) {
      els.statusText.textContent = "正在录制，系统声音已降级";
      console.warn(state.audioWarning);
    }
    startTimer();
  } catch (error) {
    cleanupRecordingRuntime();
    setRecordingUi(false);
    showResult("无法开始录制", error.message || String(error));
  }
}

function pauseOrResumeRecording() {
  if (!state.mediaRecorder) return;
  if (state.mediaRecorder.state === "recording") {
    state.mediaRecorder.pause();
    state.pausedAt = Date.now();
    setRecordingUi(true, true);
  } else if (state.mediaRecorder.state === "paused") {
    state.mediaRecorder.resume();
    state.pausedMs += Date.now() - state.pausedAt;
    state.pausedAt = 0;
    setRecordingUi(true, false);
  }
}

function stopRecording(cancel = false) {
  if (!state.mediaRecorder || state.mediaRecorder.state === "inactive") return;
  state.cancelRequested = cancel;
  state.mediaRecorder.stop();
  stopTimer();
}

async function finishRecording(mimeType) {
  const durationMs = getElapsedMs();
  const blob = new Blob(state.chunks, { type: mimeType || "video/webm" });
  const extension = extensionFromMime(mimeType || "video/webm");
  cleanupRecordingRuntime();
  setRecordingUi(false);

  if (state.cancelRequested || blob.size === 0) {
    state.chunks = [];
    showResult("录制已取消", "本次录制没有保存文件。");
    return;
  }

  const isMulti = els.modeSelect.value === "multi";
  const segmentIndex = state.segments.length + 1;
  const baseName = isMulti ? `segment_${String(segmentIndex).padStart(3, "0")}` : `recording_${nowStamp()}`;
  const arrayBuffer = await blob.arrayBuffer();
  const result = await api.saveRecording({
    arrayBuffer,
    extension,
    baseName,
    mode: isMulti ? "multi" : "normal",
    projectName: getProjectName()
  });
  const eventsResult = await saveEventsForRecording(baseName, isMulti ? "multi" : "normal", getProjectName(), result.fileName);

  state.lastSavedPath = result.filePath;

  if (isMulti) {
    const segment = {
      id: `segment_${String(segmentIndex).padStart(3, "0")}`,
      title: `片段 ${segmentIndex}`,
      order: segmentIndex,
      file: result.relativePath,
      filePath: result.filePath,
      duration: Math.round(durationMs / 100) / 10,
      sizeMb: result.sizeMb,
      eventsJson: eventsResult ? eventsResult.fileName : null,
      eventsJsonPath: eventsResult ? eventsResult.filePath : null,
      status: "confirmed",
      trim: {
        in: 0,
        out: Math.round(durationMs / 100) / 10
      }
    };
    state.segments.push(segment);
    await saveCurrentProject();
    renderSegments();
    showResult("片段已保存", `${segment.title} 已加入素材面板。\n位置：${result.filePath}${eventsResult ? `\n事件：${eventsResult.filePath}` : ""}`);
  } else {
    showResult("录制完成", `文件名：${result.fileName}\n大小：${result.sizeMb} MB\n位置：${result.filePath}${eventsResult ? `\n事件：${eventsResult.filePath}` : ""}`);
  }
}

async function saveCurrentProject() {
  const project = buildProject();
  await api.saveProject(project);
}

function getProjectName() {
  return (els.projectNameInput.value || "未命名项目").trim() || "未命名项目";
}

async function handleProjectNameChange() {
  const nextName = getProjectName();
  if (nextName === state.projectName) return;

  state.projectName = nextName;
  state.segments = [];
  state.lastSavedPath = "";
  reorderSegments();
  renderSegments();
  await saveCurrentProject();
  els.statusText.textContent = `已切换到项目：${nextName}`;
}

function buildProject() {
  const source = getCurrentSourceSize();
  const output = getOutputSize(source.width, source.height);
  const crop = getCropRect(source.width, source.height, output.width, output.height);
  return {
    id: `project_${nowStamp()}`,
    name: getProjectName(),
    mode: "multi",
    updatedAt: new Date().toISOString(),
    fps: getQuality().fps,
    captureArea: {
      preset: state.settings.capturePreset,
      x: Math.round(crop.sx),
      y: Math.round(crop.sy),
      width: Math.round(crop.sw),
      height: Math.round(crop.sh),
      outputWidth: output.width,
      outputHeight: output.height,
      offsetX: state.cropOffset.x,
      offsetY: state.cropOffset.y
    },
    audioMode: els.audioSelect.value,
    segments: state.segments
  };
}

function renderSegments() {
  const totalMs = state.segments.reduce((sum, segment) => sum + (segment.duration || 0) * 1000, 0);
  els.projectSummary.textContent = `片段 ${state.segments.length} 个，总时长 ${formatDuration(totalMs)}`;
  els.mergeBtn.disabled = state.segments.length === 0;
  els.draftBtn.disabled = state.segments.length === 0;
  els.cleanDraftBtn.disabled = state.segments.length === 0;

  if (state.segments.length === 0) {
    els.segmentsList.className = "segments-list empty";
    els.segmentsList.innerHTML = `<div class="empty-state"><strong>还没有录制片段</strong><span>切换到多段录制后，停止录制的片段会出现在这里。</span></div>`;
    return;
  }

  els.segmentsList.className = "segments-list";
  els.segmentsList.innerHTML = "";

  for (const segment of state.segments) {
    const card = document.createElement("article");
    card.className = "segment-card";
    const eventsText = segment.eventsJson ? " · events" : "";
    const sourceText = segment.source === "folder" ? " · 文件夹" : "";
    card.innerHTML = `
      <div class="segment-thumb">${String(segment.order).padStart(2, "0")}</div>
      <div class="segment-body">
        <div class="segment-title-row">
          <span class="segment-title">${segment.title}</span>
          <span class="segment-meta">${formatDuration((segment.duration || 0) * 1000)}</span>
        </div>
        <div class="segment-meta">${segment.sizeMb || 0} MB · ${segment.status}</div>
        <div class="segment-actions">
          <button data-action="up" data-id="${segment.id}">上移</button>
          <button data-action="down" data-id="${segment.id}">下移</button>
          <button data-action="rename" data-id="${segment.id}">重命名</button>
          <button data-action="delete" data-id="${segment.id}">删除</button>
        </div>
      </div>
    `;
    const metaRows = card.querySelectorAll(".segment-meta");
    if (metaRows[1]) metaRows[1].textContent += `${eventsText}${sourceText}`;
    els.segmentsList.appendChild(card);
  }
}

function reorderSegments() {
  state.segments.forEach((segment, index) => {
    segment.order = index + 1;
  });
}

async function handleSegmentAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const id = button.dataset.id;
  const index = state.segments.findIndex((segment) => segment.id === id);
  if (index < 0) return;

  if (button.dataset.action === "up" && index > 0) {
    [state.segments[index - 1], state.segments[index]] = [state.segments[index], state.segments[index - 1]];
  }

  if (button.dataset.action === "down" && index < state.segments.length - 1) {
    [state.segments[index + 1], state.segments[index]] = [state.segments[index], state.segments[index + 1]];
  }

  if (button.dataset.action === "rename") {
    const nextTitle = prompt("请输入新的片段名称", state.segments[index].title);
    if (nextTitle) state.segments[index].title = nextTitle.trim();
  }

  if (button.dataset.action === "delete") {
    const confirmed = confirm(`确认从项目中移除「${state.segments[index].title}」吗？文件会保留在磁盘上。`);
    if (confirmed) state.segments.splice(index, 1);
  }

  reorderSegments();
  renderSegments();
  await saveCurrentProject();
}

function showResult(title, body) {
  els.resultTitle.textContent = title;
  els.resultBody.textContent = body;
  els.resultOpenBtn.style.display = state.lastSavedPath ? "inline-flex" : "none";
  els.resultDialog.showModal();
}

function openSettingsDialog() {
  els.settingsSaveDir.value = state.settings.saveDir || "";
  els.settingsDraftDir.value = state.settings.draftDir || "";
  els.settingsAudio.value = state.settings.audioMode || els.audioSelect.value;
  els.settingsQuality.value = state.settings.quality || els.qualitySelect.value;
  els.settingsRecordClicks.checked = Boolean(state.settings.recordClicks);
  els.settingsRecordMousePath.checked = Boolean(state.settings.recordMousePath);
  els.settingsDialog.showModal();
}

async function saveSettingsDialog() {
  state.settings = await api.saveSettings({
    saveDir: els.settingsSaveDir.value,
    draftDir: els.settingsDraftDir.value,
    audioMode: els.settingsAudio.value,
    quality: els.settingsQuality.value,
    recordClicks: els.settingsRecordClicks.checked,
    recordMousePath: els.settingsRecordMousePath.checked
  });

  els.saveDirText.textContent = state.settings.saveDir;
  els.audioSelect.value = state.settings.audioMode;
  els.qualitySelect.value = state.settings.quality;
}

function recordPointerEvent(type, event, useFallback = false) {
  if (!state.isRecording || state.isPaused) return;
  if (type === "click" && !state.settings.recordClicks) return;
  if (type === "move" && !state.settings.recordMousePath) return;

  const point = useFallback ? getFallbackPointerSourcePosition(event) : getPointerSourcePosition(event);
  const entry = {
    type,
    time: getRecordingTimeSeconds(),
    x: point.x,
    y: point.y,
    capture_method: useFallback ? "app-window-fallback" : "preview"
  };

  if (type === "click") {
    entry.button = event.button === 2 ? "right" : event.button === 1 ? "middle" : "left";
    state.clickEvents.push(entry);
    return;
  }

  const last = state.mousePathEvents[state.mousePathEvents.length - 1];
  if (!last || Math.abs(last.x - entry.x) > 8 || Math.abs(last.y - entry.y) > 8 || entry.time - last.time > 0.2) {
    state.mousePathEvents.push(entry);
  }
}

function setBusy(button, busyText) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  return () => {
    button.textContent = originalText;
    button.disabled = false;
    renderSegments();
  };
}

async function loadSources() {
  els.sourceSelect.innerHTML = `<option value="">加载中...</option>`;
  state.sources = await api.listSources();
  els.sourceSelect.innerHTML = "";
  for (const source of state.sources) {
    const option = document.createElement("option");
    option.value = source.id;
    option.textContent = source.name;
    els.sourceSelect.appendChild(option);
  }

  const preferred = state.sources.find((source) => source.id === state.settings.sourceId) || state.sources[0];
  if (preferred) {
    els.sourceSelect.value = preferred.id;
    selectSource(preferred.id);
  }
}

function selectSource(sourceId) {
  const source = state.sources.find((item) => item.id === sourceId);
  if (!source) return;
  state.settings.sourceId = source.id;
  state.settings.sourceName = source.name;
  els.sourceNameText.textContent = source.name;
  els.sourceThumbnail.src = source.thumbnail;
  updateCropFramePosition();
  api.saveSettings({ sourceId: source.id, sourceName: source.name });
}

function bindEvents() {
  els.modeSelect.addEventListener("change", () => api.saveSettings({ mode: els.modeSelect.value }));
  els.audioSelect.addEventListener("change", () => api.saveSettings({ audioMode: els.audioSelect.value }));
  els.qualitySelect.addEventListener("change", () => api.saveSettings({ quality: els.qualitySelect.value }));
  els.sourceSelect.addEventListener("change", () => selectSource(els.sourceSelect.value));
  els.refreshSourcesBtn.addEventListener("click", loadSources);
  els.settingsBtn.addEventListener("click", openSettingsDialog);
  els.importFolderBtn.addEventListener("click", async () => {
    const folder = await api.selectFolder("选择素材文件夹");
    if (!folder) return;

    if (state.segments.length > 0) {
      const confirmed = confirm("导入文件夹会替换当前素材面板中的片段，确认继续吗？");
      if (!confirmed) return;
    }

    const restore = setBusy(els.importFolderBtn, "正在导入...");
    try {
      const result = await api.scanVideoFolder(folder);
      if (!result.success) {
        showResult("导入文件夹失败", result.error || "无法读取文件夹。");
        return;
      }

      state.segments = result.segments || [];
      reorderSegments();
      const folderName = folder.split(/[\\/]/).filter(Boolean).pop();
      if (folderName) {
        els.projectNameInput.value = folderName;
        state.projectName = getProjectName();
      }
      renderSegments();
      await saveCurrentProject();
      showResult("素材已导入", `已导入 ${state.segments.length} 个视频片段。\n文件夹：${folder}`);
    } catch (error) {
      showResult("导入文件夹失败", error.message || String(error));
    } finally {
      restore();
    }
  });
  els.chooseSaveDirBtn.addEventListener("click", async () => {
    const folder = await api.selectFolder("选择录制保存目录");
    if (!folder) return;
    state.settings.saveDir = folder;
    els.saveDirText.textContent = folder;
    await api.saveSettings({ saveDir: folder });
  });
  els.openSaveDirBtn.addEventListener("click", () => api.openPath(state.settings.saveDir));
  els.settingsSaveDirBtn.addEventListener("click", async () => {
    const folder = await api.selectFolder("选择默认保存目录");
    if (folder) els.settingsSaveDir.value = folder;
  });
  els.settingsDraftDirBtn.addEventListener("click", async () => {
    const folder = await api.selectFolder("选择剪映草稿目录");
    if (folder) els.settingsDraftDir.value = folder;
  });
  els.settingsSaveBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    await saveSettingsDialog();
    els.settingsDialog.close();
    showResult("设置已保存", "默认保存位置、草稿目录、音频、画质和事件记录设置已更新。");
  });
  els.setDefaultRangeBtn.addEventListener("click", async () => {
    state.settings.cropOffset = { ...state.cropOffset };
    state.settings.customArea = {
      x: Number(els.customX.value || 0),
      y: Number(els.customY.value || 0),
      width: Number(els.customWidth.value || 1920),
      height: Number(els.customHeight.value || 1080)
    };
    await api.saveSettings({
      capturePreset: state.settings.capturePreset,
      cropOffset: state.settings.cropOffset,
      customArea: state.settings.customArea
    });
    showResult("默认范围已保存", `当前默认录制范围为 ${getSelectedPreset().title}。`);
  });
  for (const input of [els.customX, els.customY, els.customWidth, els.customHeight]) {
    input.addEventListener("input", () => {
      applyLockedRatioFromInput(input);
      updateCropFrame();
      syncFrameFromCustomArea();
    });
    input.addEventListener("change", () => {
      applyLockedRatioFromInput(input);
      syncFrameFromCustomArea();
      saveCropSettings();
    });
  }
  els.startBtn.addEventListener("click", startRecording);
  els.pauseBtn.addEventListener("click", pauseOrResumeRecording);
  els.stopBtn.addEventListener("click", () => stopRecording(false));
  els.cancelBtn.addEventListener("click", () => {
    const confirmed = confirm("确认取消本次录制吗？取消后不会保存文件。");
    if (confirmed) stopRecording(true);
  });
  els.segmentsList.addEventListener("click", handleSegmentAction);
  els.projectNameInput.addEventListener("change", handleProjectNameChange);
  els.mergeBtn.addEventListener("click", async () => {
    const restore = setBusy(els.mergeBtn, "正在导出...");
    try {
      await saveCurrentProject();
      const result = await api.mergeSegments(buildProject());
      if (!result.success) {
        showResult("合并导出失败", result.error || "ffmpeg 合并失败。");
        return;
      }
      state.lastSavedPath = result.outputPath;
      showResult("合并导出完成", `文件：${result.outputPath}\n大小：${result.sizeMb} MB`);
    } catch (error) {
      showResult("合并导出失败", error.message || String(error));
    } finally {
      restore();
    }
  });
  els.draftBtn.addEventListener("click", async () => {
    const restore = setBusy(els.draftBtn, "正在生成...");
    try {
      await saveCurrentProject();
      const result = await api.generateDraft(buildProject());
      state.lastSavedPath = result.success ? result.draftProjectPath || result.draftRoot : result.logPath || result.configPath;
      if (!result.success) {
        showResult("剪映草稿生成失败", `${result.error || "生成失败"}\n配置：${result.configPath || ""}\n日志：${result.logPath || ""}`);
        return;
      }
      showResult(
        "剪映草稿已生成",
        `草稿目录：${result.draftProjectPath || result.draftRoot}\n剪映草稿根目录：${result.draftRoot}\n配置：${result.configPath}\n日志：${result.logPath}`
      );
    } catch (error) {
      showResult("剪映草稿生成失败", error.message || String(error));
    } finally {
      restore();
    }
  });
  els.cleanDraftBtn.addEventListener("click", async () => {
    const restore = setBusy(els.cleanDraftBtn, "正在处理...");
    try {
      await saveCurrentProject();
      const result = await api.generateCleanDraft(buildProject());
      state.lastSavedPath = result.success ? result.draftProjectPath || result.draftRoot : result.logPath || result.resultJsonPath || result.configPath;
      if (!result.success) {
        showResult("去口癖草稿生成失败", `${result.error || "生成失败"}\n配置：${result.configPath || ""}\n结果：${result.resultJsonPath || ""}\n日志：${result.logPath || ""}`);
        return;
      }

      const summary = result.workflowResult
        ? `\n剪辑片段：${result.workflowResult.total_clips || 0} 个\n删除时长：${Math.round((result.workflowResult.removed_duration || 0) * 10) / 10} 秒`
        : "";
      showResult(
        "去口癖草稿已生成",
        `草稿目录：${result.draftProjectPath || result.draftRoot}\n剪映草稿根目录：${result.draftRoot}\n配置：${result.configPath}\n结果：${result.resultJsonPath}\n日志：${result.logPath}${summary}`
      );
    } catch (error) {
      showResult("去口癖草稿生成失败", error.message || String(error));
    } finally {
      restore();
    }
  });
  els.resultOpenBtn.addEventListener("click", (event) => {
    event.preventDefault();
    if (state.lastSavedPath) api.openPath(state.lastSavedPath);
  });
  window.addEventListener("beforeunload", () => {
    cleanupRecordingRuntime();
    api.cleanupChildProcesses();
  });
  els.sourceThumbnail.addEventListener("load", setSourceSizeFromThumbnail);
  els.previewVideo.addEventListener("pointerdown", (event) => recordPointerEvent("click", event));
  els.sourceThumbnail.addEventListener("pointerdown", (event) => recordPointerEvent("click", event));
  els.previewVideo.addEventListener("pointermove", (event) => recordPointerEvent("move", event));
  els.sourceThumbnail.addEventListener("pointermove", (event) => recordPointerEvent("move", event));
  window.addEventListener("pointerdown", (event) => {
    if (event.target === els.previewVideo || event.target === els.sourceThumbnail || event.target.closest("#cropFrame")) return;
    recordPointerEvent("click", event, true);
  }, true);
}

async function init() {
  state.settings = await api.getSettings();
  els.modeSelect.value = state.settings.mode || "multi";
  els.audioSelect.value = state.settings.audioMode || "system-mic";
  els.qualitySelect.value = state.settings.quality || "1080p-30";
  els.saveDirText.textContent = state.settings.saveDir;
  state.settings.recordClicks = Boolean(state.settings.recordClicks);
  state.settings.recordMousePath = Boolean(state.settings.recordMousePath);
  state.projectName = getProjectName();
  els.customX.value = state.settings.customArea.x;
  els.customY.value = state.settings.customArea.y;
  els.customWidth.value = state.settings.customArea.width;
  els.customHeight.value = state.settings.customArea.height;
  state.cropOffset = {
    x: clamp(Number(state.settings.cropOffset?.x ?? 0.5), 0, 1),
    y: clamp(Number(state.settings.cropOffset?.y ?? 0.5), 0, 1)
  };
  renderRangePresets();
  renderSegments();
  bindEvents();
  bindCropDragging();
  window.addEventListener("resize", updateCropFramePosition);
  await loadSources();
}

init().catch((error) => {
  console.error(error);
  showResult("初始化失败", error.message || String(error));
});
