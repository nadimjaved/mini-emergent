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
const MAX_LOG_LINES = 500;

/**
 * runningProjects: Map<projectName, {
 *   name: string,
 *   pid: number,
 *   projectPath: string,
 *   command: string,
 *   args: string[],
 *   startedAt: string,
 *   status: "running" | "stopping",
 *   logs: string[],
 *   process: ReturnType<typeof execa>
 * }>
 */
const runningProjects = new Map();

const ensureDirectory = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const validateProjectName = (name) => {
  return typeof name === "string" && /^[a-zA-Z0-9-_]+$/.test(name);
};

const getProjectPath = (name) => path.join(PROJECTS_DIR, name);
const getTemplatePath = (name) => path.join(TEMPLATES_DIR, name);

const appendLog = (project, line) => {
  project.logs.push(line);
  if (project.logs.length > MAX_LOG_LINES) {
    project.logs.splice(0, project.logs.length - MAX_LOG_LINES);
  }
};

const wireProcessLoggingAndCleanup = (projectName, subprocess) => {
  const state = runningProjects.get(projectName);
  if (!state) {
    return;
  }

  const writeLog = (type, chunk) => {
    const line = chunk.toString();
    const timestamp = new Date().toISOString();
    appendLog(state, `${timestamp} ${type} ${line}`);
    const writer = type === "[stderr]" ? process.stderr : process.stdout;
    writer.write(`[${projectName}] ${line}`);
  };

  subprocess.stdout?.on("data", (chunk) => writeLog("[stdout]", chunk));
  subprocess.stderr?.on("data", (chunk) => writeLog("[stderr]", chunk));

  subprocess.then(
    () => {
      const current = runningProjects.get(projectName);
      if (!current) {
        return;
      }
      appendLog(current, `${new Date().toISOString()} [system] process exited successfully`);
      runningProjects.delete(projectName);
    },
    (error) => {
      const current = runningProjects.get(projectName);
      if (!current) {
        return;
      }
      appendLog(
        current,
        `${new Date().toISOString()} [system] process exited with error: ${error.shortMessage || error.message}`,
      );
      runningProjects.delete(projectName);
    },
  );
};

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
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to create project" });
  }
});

app.post("/projects/start", (req, res) => {
  const { name, command = "npm", args = ["start"] } = req.body;

  if (!validateProjectName(name)) {
    return res
      .status(400)
      .json({ error: "Valid project name required (letters, numbers, dash, underscore)" });
  }

  if (runningProjects.has(name)) {
    return res.status(409).json({ error: "Project already running", name });
  }

  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    return res.status(400).json({ error: "args must be an array of strings" });
  }

  const projectPath = getProjectPath(name);
  const packageJsonPath = path.join(projectPath, "package.json");

  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: "Project directory not found", projectPath });
  }

  if (command === "npm" && !fs.existsSync(packageJsonPath)) {
    return res.status(400).json({ error: "No package.json found for project", projectPath });
  }

  try {
    const subprocess = execa(command, args, {
      cwd: projectPath,
      env: process.env,
      stdio: "pipe",
      all: false,
    });

    const startedAt = new Date().toISOString();
    const state = {
      name,
      pid: subprocess.pid,
      projectPath,
      command,
      args,
      startedAt,
      status: "running",
      logs: [`${startedAt} [system] started command: ${command} ${args.join(" ")}`],
      process: subprocess,
    };

    runningProjects.set(name, state);
    wireProcessLoggingAndCleanup(name, subprocess);

    return res.json({
      ok: true,
      message: "Project started",
      name,
      pid: subprocess.pid,
      startedAt,
      command,
      args,
      projectPath,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to start project", details: error.message });
  }
});

app.post("/projects/stop", async (req, res) => {
  const { name } = req.body;

  if (!validateProjectName(name)) {
    return res
      .status(400)
      .json({ error: "Valid project name required (letters, numbers, dash, underscore)" });
  }

  const state = runningProjects.get(name);
  if (!state) {
    return res.status(404).json({ error: "Project is not running", name });
  }

  try {
    state.status = "stopping";
    appendLog(state, `${new Date().toISOString()} [system] stop requested`);

    state.process.kill("SIGTERM", {
      forceKillAfterDelay: 5000,
    });

    return res.json({ ok: true, message: "Stop signal sent", name, pid: state.pid });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to stop project", details: error.message });
  }
});

app.get("/projects/running", (req, res) => {
  const projects = Array.from(runningProjects.values()).map(({ process: _, ...project }) => project);
  return res.json({ ok: true, count: projects.length, projects });
});

app.get("/projects/:name/logs", (req, res) => {
  const { name } = req.params;
  const limit = Number(req.query.limit) || 200;

  if (!validateProjectName(name)) {
    return res
      .status(400)
      .json({ error: "Valid project name required (letters, numbers, dash, underscore)" });
  }

  const state = runningProjects.get(name);
  if (!state) {
    return res.status(404).json({ error: "Project is not running", name });
  }

  const logs = state.logs.slice(-Math.min(limit, MAX_LOG_LINES));
  return res.json({ ok: true, name, count: logs.length, logs });
});

app.listen(7000, () => {
  console.log("🧠 Mini-Emergent controller running at http://localhost:7000");
});
