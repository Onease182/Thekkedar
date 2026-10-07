# Thekkedar Desktop (PySide6)

A native, offline-first desktop conversion of the PlanForge/Thekkedar construction workspace. It keeps the core workflow of the original application while replacing the Next.js/React runtime with PySide6 and SQLite.

## Included

- Native dashboard with project, task, plan, and notification summaries
- Project management with task/plan counts
- Task management: create tasks, assign trades/people, priority, status, due dates, tags, and linked plans
- Plan & markup workspace with a drawing canvas and pin/rectangle/circle tools
- Local SQLite persistence at `~/.thekkedar/thekkedar.db`
- Demo data seeded on first launch for immediate evaluation
- No server or internet connection required

## Run

```bash
cd desktop_app
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

On Windows, use `.venv\\Scripts\\activate` instead.

## Notes

This is a desktop-first offline implementation of the original scope. The web API, JWT authentication, service worker sync, and browser IndexedDB are intentionally replaced by local SQLite storage and a native window. The schema is extensible for future attachments, richer PDF rendering, user accounts, and sync adapters.
