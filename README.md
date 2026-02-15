# mini-emergent

A lightweight controller inspired by Emergent.

## Features
- Create projects from templates.
- Start a project with `npm start` via `execa`.
- Stop a running project.
- Track running processes in-memory.

## API
Base URL: `http://localhost:7000`

- `GET /health`
- `GET /projects`
- `POST /projects/create` with `{ "name": "my-app", "template": "basic-app" }`
- `POST /projects/start` with `{ "name": "my-app" }`
- `POST /projects/stop` with `{ "name": "my-app" }`
- `GET /projects/running`

## Run
```bash
cd controller
npm install
npm start
```
