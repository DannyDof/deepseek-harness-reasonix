#!/usr/bin/env node
/**
 * 上游版本同步（第 12/13 章"持续融合"机制）。
 *
 * 拉取 dsh / reasonix 两个上游仓库默认分支的最新提交，与 upstream/pins.json 比对：
 *   node scripts/sync-upstream.mjs          # 只报告
 *   node scripts/sync-upstream.mjs --write  # 报告并更新 pins.json
 *
 * 最后一行输出 `changed=true|false`，供 CI 捕获。
 */
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PINS_PATH = path.join(__dirname, "..", "upstream", "pins.json");

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "reasonix-fused-sync", Accept: "application/vnd.github+json" } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode === 200) resolve(JSON.parse(body));
        else if (res.statusCode === 403 || res.statusCode === 429) reject(new Error(`rate-limited (${res.statusCode})`));
        else reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("timeout")));
  });
}

async function latestSha(owner, repo) {
  const repoInfo = await fetchJson(`https://api.github.com/repos/${owner}/${repo}`);
  const branch = repoInfo.default_branch;
  const commits = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=1`);
  return { branch, sha: commits[0]?.sha ?? "" };
}

async function main() {
  const write = process.argv.includes("--write");
  const pins = JSON.parse(fs.readFileSync(PINS_PATH, "utf8"));
  let anyChanged = false;
  const report = [];

  for (const [name, pin] of Object.entries(pins)) {
    try {
      const { branch, sha } = await latestSha(pin.owner, pin.repo);
      const changed = pin.sha !== sha && sha !== "";
      if (changed) anyChanged = true;
      report.push({ name, owner: pin.owner, repo: pin.repo, branch, sha, changed });
      if (write && sha) {
        pin.sha = sha;
        pin.updatedAt = new Date().toISOString();
      }
      console.log(`${name}: ${pin.owner}/${pin.repo} @ ${branch} = ${sha || "(unknown)"}${changed ? "  [CHANGED]" : ""}`);
    } catch (err) {
      console.error(`${name}: ${err.message}`);
    }
  }

  if (write) {
    fs.writeFileSync(PINS_PATH, JSON.stringify(pins, null, 2) + "\n", "utf8");
  }

  console.log(`changed=${anyChanged}`);
}

main().catch((err) => {
  console.error(err.message);
  console.log("changed=false");
  process.exit(0);
});
