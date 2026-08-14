// Reasonix 融合桌面壳（Electron）
// 启动内置融合服务（app/fused.cjs，含 dsh 事件管线 + 融合 web UI），再打开窗口。
const { app, BrowserWindow } = require("electron");
const path = require("path");

const PORT = 8787;
let server = null;
let win = null;

async function bootstrap() {
  // 单文件打包产物由 scripts/bundle.mjs 生成（CI 阶段）
  const { startServer } = require(path.join(__dirname, "app", "fused.cjs"));
  server = await startServer(PORT, "127.0.0.1");

  win = new BrowserWindow({
    width: 1040,
    height: 760,
    title: "Reasonix",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.removeMenu();
  await win.loadURL(`http://127.0.0.1:${PORT}`);
}

app.whenReady().then(bootstrap);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && server) {
    win = new BrowserWindow({ width: 1040, height: 760 });
    void win.loadURL(`http://127.0.0.1:${PORT}`);
  }
});

app.on("will-quit", () => {
  if (server) server.close();
});
