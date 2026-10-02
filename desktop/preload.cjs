const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("heycarDesktop", {
  openAdmin: (view) => ipcRenderer.invoke("open-admin", view),
  openLauncher: () => ipcRenderer.invoke("open-launcher")
});
