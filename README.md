# mini-emergent

A minimal controller service inspired by Emergent that can create, start, stop, and monitor local app projects.

## What it does

- Creates projects from local templates.
- Starts a project by spawning a command (default: `npm start`) in that project folder via `execa`.
- Tracks running projects in-memory (`Map`) with process metadata.
- Streams and stores recent process logs.
- Stops running projects with graceful termination.

## API

Base URL: `http://localhost:7000`

### Health
- `GET /health`

### Projects
- `GET /projects` — list project directories and whether they are running.
- `POST /projects/create`
  - Body: `{ "name": "my-app", "template": "basic-app" }`
- `POST /projects/start`
  - Body: `{ "name": "my-app", "command": "npm", "args": ["start"] }`
- `POST /projects/stop`
  - Body: `{ "name": "my-app" }`
- `GET /projects/running` — list active subprocesses tracked in memory.
- `GET /projects/:name/logs?limit=200` — get in-memory logs for a running project.

## Run

```bash
cd controller
npm install
npm start
```
