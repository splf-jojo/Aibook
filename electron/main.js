const { app, BrowserWindow, ipcMain, nativeImage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const WebSocket = require("ws");

const API_URL = process.env.CANVAS_API_URL || "http://localhost:8000";
const WS_URL = API_URL.replace(/^http/, "ws");

let mainWindow = null;
let currentSession = null;
let socket = null;
let reconnectTimer = null;
let heartbeatTimer = null;
const inFlight = new Set();
const receivedImages = new Map();

function sessionFile() {
  return path.join(app.getPath("userData"), "session.json");
}

async function saveSession(session) {
  await fs.writeFile(sessionFile(), JSON.stringify(session), { encoding: "utf8", mode: 0o600 });
}

async function clearSession() {
  try {
    await fs.unlink(sessionFile());
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function api(pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (currentSession?.token) headers.Authorization = `Bearer ${currentSession.token}`;
  return fetch(`${API_URL}${pathname}`, { ...options, headers });
}

function transferDirectory(userId) {
  return path.join(app.getPath("temp"), "CanvasTransfer", userId);
}

async function loadLocalImages(userId) {
  receivedImages.clear();
  const directory = transferDirectory(userId);
  let entries = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Failed to read local images", error);
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const metadata = JSON.parse(await fs.readFile(path.join(directory, entry.name), "utf8"));
      const bytes = await fs.readFile(metadata.local_path);
      receivedImages.set(metadata.id, {
        ...metadata,
        data_url: `data:${metadata.mime_type};base64,${bytes.toString("base64")}`,
      });
    } catch (error) {
      console.error(`Failed to restore ${entry.name}`, error);
    }
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".png")) continue;
    const id = path.basename(entry.name, ".png");
    if (receivedImages.has(id)) continue;
    try {
      const localPath = path.join(directory, entry.name);
      const [bytes, stats] = await Promise.all([fs.readFile(localPath), fs.stat(localPath)]);
      const dimensions = nativeImage.createFromPath(localPath).getSize();
      const metadata = {
        id,
        filename: entry.name,
        mime_type: "image/png",
        width: dimensions.width,
        height: dimensions.height,
        size_bytes: stats.size,
        created_at: stats.birthtime.toISOString(),
        local_path: localPath,
      };
      await fs.writeFile(path.join(directory, `${id}.json`), JSON.stringify(metadata), "utf8");
      receivedImages.set(id, {
        ...metadata,
        data_url: `data:image/png;base64,${bytes.toString("base64")}`,
      });
    } catch (error) {
      console.error(`Failed to index ${entry.name}`, error);
    }
  }
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

async function receiveImage(metadata) {
  if (!currentSession || inFlight.has(metadata.id)) return;
  inFlight.add(metadata.id);
  try {
    const response = await api(`/api/images/${metadata.id}/content`);
    if (!response.ok) return;
    const bytes = Buffer.from(await response.arrayBuffer());
    const destination = transferDirectory(currentSession.user.id);
    await fs.mkdir(destination, { recursive: true });
    const localPath = path.join(destination, `${metadata.id}.png`);
    await fs.writeFile(localPath, bytes);

    const record = {
      ...metadata,
      local_path: localPath,
      data_url: `data:${metadata.mime_type};base64,${bytes.toString("base64")}`,
    };
    await fs.writeFile(
      path.join(destination, `${metadata.id}.json`),
      JSON.stringify({ ...record, data_url: undefined }),
      "utf8",
    );
    receivedImages.set(record.id, record);
    sendToRenderer("image-received", record);
    await api(`/api/images/${metadata.id}/ack`, { method: "POST" });
  } finally {
    inFlight.delete(metadata.id);
  }
}

async function receivePending() {
  if (!currentSession) return;
  try {
    const response = await api("/api/images");
    if (!response.ok) return;
    const images = await response.json();
    for (const image of images) await receiveImage(image);
  } catch {
    // The websocket reconnect loop will retry after the server becomes available.
  }
}

function stopSocket() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  reconnectTimer = null;
  heartbeatTimer = null;
  if (socket) {
    socket.removeAllListeners();
    socket.close();
    socket = null;
  }
}

function connectSocket() {
  stopSocket();
  if (!currentSession) return;
  const sessionAtConnect = currentSession;
  socket = new WebSocket(`${WS_URL}/ws`, {
    headers: {
      Authorization: `Bearer ${currentSession.token}`,
    },
  });

  socket.on("open", () => {
    heartbeatTimer = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
    }, 30000);
    void receivePending();
  });

  socket.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === "image" && message.image) void receiveImage(message.image);
    } catch {
      // Ignore malformed messages; only server-originated image events are handled.
    }
  });

  socket.on("close", () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    socket = null;
    if (currentSession === sessionAtConnect) {
      reconnectTimer = setTimeout(connectSocket, 2000);
    }
  });

  socket.on("error", () => socket?.close());
}

async function authenticate(username, password) {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) return null;
  const { access_token: token } = await response.json();
  const userResponse = await fetch(`${API_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!userResponse.ok) return null;
  const user = await userResponse.json();
  currentSession = { token, user };
  await saveSession(currentSession);
  await loadLocalImages(user.id);
  connectSocket();
  return user;
}

async function restoreSession() {
  try {
    const stored = JSON.parse(await fs.readFile(sessionFile(), "utf8"));
    currentSession = stored;
    const response = await api("/api/auth/me");
    if (!response.ok) throw new Error("expired");
    const user = await response.json();
    currentSession.user = user;
    await loadLocalImages(user.id);
    connectSocket();
    return user;
  } catch {
    currentSession = null;
    await clearSession();
    return null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: "#f4f5f7",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("auth:restore", restoreSession);
ipcMain.handle("auth:login", (_, credentials) =>
  authenticate(credentials.username, credentials.password),
);
ipcMain.handle("images:list", () => Array.from(receivedImages.values()));
ipcMain.handle("auth:logout", async () => {
  stopSocket();
  currentSession = null;
  receivedImages.clear();
  await clearSession();
  return true;
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", stopSocket);
