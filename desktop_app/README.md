# Thekkedar Desktop for Windows (PySide6)

A native, offline-first Windows desktop conversion of the PlanForge/Thekkedar construction workspace. It keeps the core workflow of the original application while replacing the Next.js/React runtime with PySide6 and SQLite.

PySide6 is cross-platform, but the supplied launch and packaging scripts are specifically designed for Windows 10/11.

## Included

- Native Windows desktop dashboard with project, task, plan, and notification summaries
- Project management with task/plan counts
- Task management: create tasks, assign trades/people, priority, status, due dates, tags, and linked plans
- Plan & markup workspace with a drawing canvas and pin/rectangle/circle tools
- Local SQLite persistence at `%USERPROFILE%\\.thekkedar\\thekkedar.db`
- Demo data seeded on first launch for immediate evaluation
- No server or internet connection required after dependencies are installed

## Option 1: Run from source on Windows

Install **Python 3.11 or newer** from https://www.python.org/downloads/windows/ and make sure **Add Python to PATH** is enabled during setup.

Open Command Prompt in this folder and run:

```bat
python -m venv .venv
.venv\\Scripts\\activate
python -m pip install -r requirements.txt
python main.py
```

Or double-click `run_windows.bat` after installing the dependencies.

## Option 2: Build a standalone Windows `.exe`

On a Windows machine, double-click `build_windows.bat`, or run:

```bat
python -m pip install -r requirements.txt
python -m pip install pyinstaller
pyinstaller --noconfirm --clean --windowed --name Thekkedar --collect-all PySide6 main.py
```

The finished application will be at:

```text
dist\\Thekkedar\\Thekkedar.exe
```

The generated `dist\\Thekkedar` folder can be copied to another Windows machine. No Python installation is required on that target machine.

## Notes

This is a desktop-first offline implementation of the original scope. The web API, JWT authentication, service worker sync, and browser IndexedDB are replaced by local SQLite storage and a native window. The schema is extensible for future attachments, richer PDF rendering, user accounts, and synchronization adapters.
