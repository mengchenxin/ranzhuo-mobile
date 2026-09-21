const os = require("node:os");

// Node 24 can fail os.userInfo() on some non-ASCII Windows account names.
// Capacitor only needs the shell here, so provide a safe fallback.
const originalUserInfo = os.userInfo;
os.userInfo = (...args) => {
  try {
    return originalUserInfo(...args);
  } catch {
    return {
      uid: -1,
      gid: -1,
      username: process.env.USERNAME || "user",
      homedir: process.env.USERPROFILE || process.cwd(),
      shell: process.env.COMSPEC || "cmd.exe",
    };
  }
};
