import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 8798;
const baseUrl = "http://127.0.0.1:" + port;
const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    RANZHUO_GATEWAY_PORT: String(port),
    RANZHUO_DATA_DIR: path.join(
      root,
      "server",
      "evaluation-data",
      String(process.pid),
    ),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(baseUrl + "/api/health");
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Gateway did not become healthy");
}

try {
  await waitForHealth();
  const includeLive =
    process.argv.includes("--live") && Boolean(process.env.DEEPSEEK_API_KEY);
  const response = await fetch(baseUrl + "/api/evaluations/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider: "deepseek",
      model: process.env.RANZHUO_EVAL_MODEL || "deepseek-flash",
      includeLive,
    }),
  });
  const result = await response.json();
  console.log(JSON.stringify(result, null, 2));
  if (!response.ok || result.failed) process.exitCode = 1;
} finally {
  child.kill();
}
