#!/usr/bin/env node
/**
 * 打包脚本（CI-only）：用 esbuild 把融合应用打成单文件，供 electron-builder 封装。
 * 运行前需 `npm i -D esbuild`（GitHub Actions 中网络可靠，本地可选）。
 */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "apps", "desktop", "app");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// 1) 单文件打包 launcher（内联 bridge + bundle-reasonix）
await build({
  entryPoints: [path.join(root, "launcher", "src", "main.ts")],
  bundle: true,
  platform: "node",
  target: "node16",
  format: "cjs",
  outfile: path.join(outDir, "fused.cjs"),
  external: ["electron"],
  logLevel: "info",
});

// 2) 复制 web 资产
fs.cpSync(path.join(root, "launcher", "web"), path.join(outDir, "web"), { recursive: true });

console.log(`打包完成: ${outDir}`);
