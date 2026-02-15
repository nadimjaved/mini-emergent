import express from "express";
import fs from "fs";
import path from "path";
import { execa } from "execa";

const app = express();
app.use(express.json());

const runningProjects = new Map();

const getProjectPath = (name) => path.resolve("../projects", name);

// Create project from template
app.post("/projects/create", (req, res) => {
  const { name, template = "basic-app" } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Project name required" });
  }

  const templatePath = path.resolve("../templates", template);
  const projectPath = getProjectPath(name);

  try {
    fs.cpSync(templatePath, projectPath, { recursive: true });
    res.json({ ok: true, message: "Project created", projectPath });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create project" });
  }
});

app.post("/projects/start", (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Project name required" });
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
    });

    const startedAt = new Date().toISOString();
    runningProjects.set(name, {
      name,
      pid: subprocess.pid,
      projectPath,
      startedAt,
      process: subprocess,
    });

    subprocess.stdout?.on("data", (chunk) => {
      process.stdout.write(`[${name}] ${chunk}`);
    });

    subprocess.stderr?.on("data", (chunk) => {
      process.stderr.write(`[${name}] ${chunk}`);
    });

    subprocess.then(
      () => {
        runningProjects.delete(name);
        console.log(`[${name}] exited successfully`);
      },
      (error) => {
        runningProjects.delete(name);
        console.error(`[${name}] exited with error:`, error.shortMessage || error.message);
      },
    );

    return res.json({
      ok: true,
      message: "Project started",
      name,
      pid: subprocess.pid,
      startedAt,
      projectPath,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to start project", details: error.message });
  }
});

app.post("/projects/stop", async (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Project name required" });
  }

  const running = runningProjects.get(name);
  if (!running) {
    return res.status(404).json({ error: "Project is not running", name });
  }

  try {
    running.process.kill("SIGTERM", {
      forceKillAfterDelay: 5000,
    });

    return res.json({ ok: true, message: "Stop signal sent", name, pid: running.pid });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to stop project", details: error.message });
  }
});

app.get("/projects/running", (req, res) => {
  const projects = Array.from(runningProjects.values()).map(({ process: _, ...project }) => project);
  return res.json({ ok: true, count: projects.length, projects });
});

app.listen(7000, () => {
  console.log("🧠 Mini-Emergent controller running at http://localhost:7000");
});
