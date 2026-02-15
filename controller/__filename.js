import path from "node:path";

export function getProjectPath(name) {
  // implementation
}
// ...existing code...
export const __filename = fileURLToPath(import.meta.url);
// ...existing code...// ...existing code...
const getProjectPath = (name) => path.resolve("../projects", name);
