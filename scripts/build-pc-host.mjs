import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const vite = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const result = spawnSync(process.execPath, [vite, "build"], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
  env: {
    ...process.env,
    VITE_CREATIVE_STUDIO_ADAPTER: "http",
    VITE_CREATIVE_STUDIO_PC_HOST: "true",
  },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
