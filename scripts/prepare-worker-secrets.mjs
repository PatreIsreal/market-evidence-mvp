import { existsSync, lstatSync, realpathSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const secretFile = path.join(projectRoot, ".dev.vars");
const workerConfigDir = path.join(projectRoot, "dist", "server");
const workerSecretFile = path.join(workerConfigDir, ".dev.vars");

if (!existsSync(secretFile)) {
  throw new Error("Missing .dev.vars. Configure server-only runtime credentials before starting the built worker.");
}
if (!existsSync(workerConfigDir)) {
  throw new Error("Missing dist/server. Run npm run build before starting the built worker.");
}

let existingWorkerSecret;
try {
  existingWorkerSecret = lstatSync(workerSecretFile);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

if (existingWorkerSecret) {
  if (!lstatSync(workerSecretFile).isSymbolicLink() || realpathSync(workerSecretFile) !== realpathSync(secretFile)) {
    throw new Error("Refusing to replace dist/server/.dev.vars because it is not the expected secret-file symlink.");
  }
} else {
  symlinkSync(path.relative(workerConfigDir, secretFile), workerSecretFile, "file");
}
