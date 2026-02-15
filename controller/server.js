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

const validateProjectName = (name) => typeof name === "string" && /^[a-zA-Z0-9-_]+$/.test(name);
const getProjectPath = (name) => path.join(PROJECTS_DIR, name);
const getTemplatePath = (template) => path.join(TEMPLATES_DIR, template);
const serializeProject = ({ process: _process, ...project }) => project;

if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

app.get("/health", (req, res) => {
  return res.json({ ok: true, service: "mini-emergent-controller" });
});

app.post("/projects/create", (req, res) => {
  const { name, template = "basic-app" } = req.body;

  if (!validateProjectName(name)) {
    return res.status(400).json({ error: "Valid project name required" });
  }

  const projectPath = getProjectPath(name);
  const templatePath = getTemplatePath(template);

  if (!fs.existsSync(templatePath)) {
    return res.status(404).json({ error: "Template not found", template });
  }

  if (fs.existsSync(projectPath)) {
    return res.status(409).json({ error: "Project already exists", name });
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
    return res.status(400).json({ error: "Valid project name required" });
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

  try {
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
      () => runningProjects.delete(name),
      () => runningProjects.delete(name),
    );

    return res.json({ ok: true, message: "Project started", project: serializeProject(runningProjects.get(name)) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to start project", details: error.message });
  }
});

app.post("/projects/stop", (req, res) => {
  const { name } = req.body;

  if (!validateProjectName(name)) {
    return res.status(400).json({ error: "Valid project name required" });
  }

  const state = runningProjects.get(name);
  if (!state) {
    return res.status(404).json({ error: "Project is not running", name });
  }

  try {
    state.status = "stopping";
    state.process.kill("SIGTERM", { forceKillAfterDelay: 5000 });
    return res.json({ ok: true, message: "Stop signal sent", name, pid: state.pid });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to stop project", details: error.message });
  }
});

app.get("/projects/running", (req, res) => {
  const projects = Array.from(runningProjects.values()).map(serializeProject);
  return res.json({ ok: true, count: projects.length, projects });
});

app.listen(7000, () => {
  console.log("🧠 Mini-Emergent controller running at http://localhost:7000");
});
