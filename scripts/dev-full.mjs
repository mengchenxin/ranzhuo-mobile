import { spawn } from "node:child_process";

function startScript(script) {
  if (process.platform === "win32") {
    return spawn(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", "npm run " + script],
      { stdio: "inherit" },
    );
  }
  return spawn("npm", ["run", script], { stdio: "inherit" });
}

const children = [startScript("gateway"), startScript("dev")];

let shuttingDown = false;
function shutdown(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
children.forEach((child) => {
  child.on("exit", (code) => {
    if (!shuttingDown && code !== 0) {
      shutdown();
      process.exitCode = code || 1;
    }
  });
});
