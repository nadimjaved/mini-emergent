import express from "express";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json());

// Create project from template
app.post("/projects/create", (req, res) => {
  const { name, template = "basic-app" } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Project name required" });
  }

  const templatePath = path.resolve("../templates", template);
  const projectPath = path.resolve("../projects", name);

  try {
    fs.cpSync(templatePath, projectPath, { recursive: true });
    res.json({ ok: true, message: "Project created", projectPath });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create project" });
  }
});

app.listen(7000, () => {
  console.log("🧠 Mini-Emergent controller running at http://localhost:7000");
});
