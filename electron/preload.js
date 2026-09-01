const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("canvasDesktop", {
  restore: () => ipcRenderer.invoke("auth:restore"),
  login: (credentials) => ipcRenderer.invoke("auth:login", credentials),
  logout: () => ipcRenderer.invoke("auth:logout"),
  listImages: () => ipcRenderer.invoke("images:list"),
  onImage: (callback) => {
    const listener = (_, image) => callback(image);
    ipcRenderer.on("image-received", listener);
    return () => ipcRenderer.removeListener("image-received", listener);
  },
});
