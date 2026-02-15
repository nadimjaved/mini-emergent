import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execa } from "execa";

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const PROJECTS_DIR = path.join(ROOT_DIR, "projects");
const TEMPLATES_DIR = path.join(ROOT_DIR, "templates");

const runningProjects = new Map();

const ensureDirectory = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const validateProjectName = (name) => typeof name === "string" && /^[a-zA-Z0-9-_]+$/.test(name);
const getProjectPath = (name) => path.join(PROJECTS_DIR, name);
const getTemplatePath = (template) => path.join(TEMPLATES_DIR, template);

const serializeRunningProject = ({ process: _, ...project }) => project;

ensureDirectory(PROJECTS_DIR);

app.get("/health", (req, res) => {
  return res.json({ ok: true, service: "mini-emergent-controller" });
});

app.get("/projects", (req, res) => {
  const projects = fs
    .readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      projectPath: getProjectPath(entry.name),
      running: runningProjects.has(entry.name),
    }));

  return res.json({ ok: true, count: projects.length, projects });
});

app.post("/projects/create", (req, res) => {
  const { name, template = "basic-app" } = req.body;

  if (!validateProjectName(name)) {
    return res
      .status(400)
      .json({ error: "Valid project name required (letters, numbers, dash, underscore)" });
  }

  const templatePath = getTemplatePath(template);
  const projectPath = getProjectPath(name);

  if (!fs.existsSync(templatePath)) {
    return res.status(404).json({ error: "Template not found", template });
  }

  if (fs.existsSync(projectPath)) {
    return res.status(409).json({ error: "Project already exists", name, projectPath });
  }

  try {
    fs.cpSync(templatePath, projectPath, { recursive: true });
    return res.json({ ok: true, message: "Project created", name, template, projectPath });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to create project" });
  }
});

app.post("/projects/start", (req, res) => {
  const { name } = req.body;

  if (!validateProjectName(name)) {
    return res
      .status(400)
      .json({ error: "Valid project name required (letters, numbers, dash, underscore)" });
  }

  if (runningProjects.has(name)) {
    return res.status(409).json({ error: "Project already running", name });
  }

  const projectPath = getProjectPath(name);
  const packageJsonPath = path.join(projectPath, "package.json");

  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: "Project directory not found", projectPath });
  }

  if (!fs.existsSync(packageJsonPath)) {
    return res.status(400).json({ error: "No package.json found for project", projectPath });
  }

  const subprocess = execa("npm", ["start"], {
    cwd: projectPath,
    env: process.env,
    stdio: "pipe",
  });

  const startedAt = new Date().toISOString();
  runningProjects.set(name, {
    name,
    pid: subprocess.pid,
    projectPath,
    command: "npm",
    args: ["start"],
    startedAt,
    status: "running",
    process: subprocess,
  });

  subprocess.stdout?.on("data", (chunk) => {
    process.stdout.write(`[${name}] ${chunk.toString()}`);
  });

  subprocess.stderr?.on("data", (chunk) => {
    process.stderr.write(`[${name}] ${chunk.toString()}`);
  });

  subprocess.then(
    () => {
      runningProjects.delete(name);
      console.log(`[${name}] process exited successfully`);
    },
    (error) => {
      runningProjects.delete(name);
      console.error(`[${name}] process exited with error: ${error.shortMessage || error.message}`);
    },
  );

  return res.json({
    ok: true,
    message: "Project started",
    project: serializeRunningProject(runningProjects.get(name)),
  });
});

app.post("/projects/stop", (req, res) => {
  const { name } = req.body;

  if (!validateProjectName(name)) {
    return res
      .status(400)
      .json({ error: "Valid project name required (letters, numbers, dash, underscore)" });
  }

  const running = runningProjects.get(name);
  if (!running) {
    return res.status(404).json({ error: "Project is not running", name });
  }

  try {
    running.status = "stopping";
    running.process.kill("SIGTERM", { forceKillAfterDelay: 5000 });
    return res.json({ ok: true, message: "Stop signal sent", name, pid: running.pid });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to stop project", details: error.message });
  }
});

app.get("/projects/running", (req, res) => {
  const projects = Array.from(runningProjects.values()).map(serializeRunningProject);
  return res.json({ ok: true, count: projects.length, projects });
});

app.listen(7000, () => {
  console.log("🧠 Mini-Emergent controller running at http://localhost:7000");
});
