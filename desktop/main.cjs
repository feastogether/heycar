const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");

const SITE_URL = "https://heycar.airvan.workers.dev";
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    show: false,
    fullscreen: true,
    autoHideMenuBar: true,
    backgroundColor: "#eef4f8",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, "launcher.html"));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(SITE_URL)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
}

ipcMain.handle("open-admin", (_event, view) => {
  const allowed = new Set(["vehicleLoans", "mailManagement"]);
  if (!allowed.has(view)) return false;
  return mainWindow.loadURL(`${SITE_URL}/?desktop=${encodeURIComponent(view)}`);
});
ipcMain.handle("open-launcher", () => mainWindow.loadFile(path.join(__dirname, "launcher.html")));

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
