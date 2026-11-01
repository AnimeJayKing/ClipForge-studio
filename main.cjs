const path = require("node:path");
const { app, BrowserWindow, session } = require("electron");

app.setName("ClipForge Studio");
if (process.platform === "win32") app.setAppUserModelId("studio.clipforge.desktop");

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 720,
    backgroundColor: "#f1f2ed",
    title: "ClipForge Studio",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });

  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (targetUrl.startsWith("http:") || targetUrl.startsWith("https:")) event.preventDefault();
  });
  window.loadFile(path.join(__dirname, "dist", "index.html"));
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (_details, callback) => callback({ cancel: true }),
  );
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
