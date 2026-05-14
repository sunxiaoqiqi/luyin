const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("recorderApi", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  selectFolder: (title) => ipcRenderer.invoke("dialog:select-folder", title),
  listSources: () => ipcRenderer.invoke("sources:list"),
  saveRecording: (payload) => ipcRenderer.invoke("recording:save", payload),
  saveEvents: (payload) => ipcRenderer.invoke("events:save", payload),
  scanVideoFolder: (folderPath) => ipcRenderer.invoke("folder:scan-videos", folderPath),
  saveProject: (project) => ipcRenderer.invoke("project:save", project),
  generateDraftConfig: (project) => ipcRenderer.invoke("draft:generate-config", project),
  generateDraft: (project) => ipcRenderer.invoke("draft:generate", project),
  generateCleanDraft: (project) => ipcRenderer.invoke("verbal-cleaner:generate-draft", project),
  mergeSegments: (project) => ipcRenderer.invoke("segments:merge", project),
  openPath: (targetPath) => ipcRenderer.invoke("shell:open-path", targetPath),
  cleanupChildProcesses: () => ipcRenderer.invoke("app:cleanup-child-processes"),
  quit: () => ipcRenderer.invoke("app:quit")
});
