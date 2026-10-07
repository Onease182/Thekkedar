from __future__ import annotations

import csv
import json
import shutil
import sqlite3
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

from PySide6.QtCore import Qt, QRectF, QPointF, Signal, QUrl
from PySide6.QtGui import QColor, QBrush, QPen, QPainter, QFont, QAction, QDesktopServices
from PySide6.QtWidgets import (
    QApplication, QAbstractItemView, QDialog, QDialogButtonBox, QFileDialog,
    QFormLayout, QFrame, QGraphicsEllipseItem, QGraphicsLineItem,
    QGraphicsRectItem, QGraphicsScene, QGraphicsTextItem, QGraphicsView,
    QHBoxLayout, QLabel, QLineEdit, QListWidget, QListWidgetItem, QMainWindow,
    QMessageBox, QPushButton, QScrollArea, QSplitter, QStackedWidget,
    QTableWidget, QTableWidgetItem, QTextEdit, QToolBar, QVBoxLayout, QWidget,
    QComboBox, QSpinBox
)

APP_DIR = Path.home() / ".thekkedar"
DB_PATH = APP_DIR / "thekkedar.db"
ACCENT = "#c9783d"
NAVY = "#17324d"
MUTED = "#718096"
BG = "#f5f7fa"


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


class Database:
    def __init__(self, path: Path = DB_PATH):
        APP_DIR.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.create_schema()
        self.seed_if_empty()

    def create_schema(self):
        self.conn.executescript("""
        CREATE TABLE IF NOT EXISTS projects(
          id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, code TEXT NOT NULL,
          description TEXT, status TEXT DEFAULT 'Active', updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS plans(
          id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, title TEXT NOT NULL,
          file_name TEXT, file_path TEXT, description TEXT, updated_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS tasks(
          id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, plan_id INTEGER,
          title TEXT NOT NULL, description TEXT, assignee TEXT, trade TEXT, location TEXT,
          priority TEXT DEFAULT 'P2', status TEXT DEFAULT 'open', due_date TEXT, tags TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE SET NULL);
        CREATE TABLE IF NOT EXISTS markups(
          id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL, kind TEXT NOT NULL,
          x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
          label TEXT, created_at TEXT NOT NULL,
          FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS notifications(
          id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT, is_read INTEGER DEFAULT 0,
          created_at TEXT NOT NULL);
        """)
        self.conn.commit()

    def seed_if_empty(self):
        if self.conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0]:
            return
        t = now()
        p1 = self.add_project("Riverside Commercial Center", "RCC-24", "Mixed-use commercial development with retail and office floors")
        p2 = self.add_project("Northside Residence", "NSR-25", "Residential block and site utilities")
        plan = self.add_plan(p1, "Level 03 Architectural Plan", "A-103.pdf", "Architectural floor plan for Level 03")
        self.add_plan(p1, "Structural Foundation Plan", "S-001.pdf", "Foundation and structural grid")
        self.add_task(p1, plan, "Resolve beam clash at grid B-4", "Coordinate beam depth with MEP routing before pour.", "Arun Sharma", "Structural", "Level 03 / Grid B-4", "P1", "blocked", (date.today() + timedelta(days=2)).isoformat(), "coordination,beam")
        self.add_task(p1, plan, "Install north corridor fire doors", "Verify hardware and fire rating on delivery.", "Maya Joshi", "Architectural", "North corridor", "P2", "in_progress", (date.today() + timedelta(days=5)).isoformat(), "doors,inspection")
        self.add_task(p1, plan, "Update ceiling coordination markup", "Add revised diffuser locations to the plan.", "Rohan Das", "MEP", "Level 03", "P3", "open", (date.today() + timedelta(days=9)).isoformat(), "markup")
        self.add_task(p2, None, "Confirm waterproofing subcontractor", "Review quotes and scope exclusions.", "Maya Joshi", "Procurement", "Basement", "P2", "open", (date.today() + timedelta(days=3)).isoformat(), "vendor")
        self.conn.execute("INSERT INTO notifications(title, body, created_at) VALUES(?,?,?)", ("Welcome to Thekkedar Desktop", "Your offline construction workspace is ready.", t))
        self.conn.commit()

    def add_project(self, name, code, description):
        cur = self.conn.execute("INSERT INTO projects(name,code,description,updated_at) VALUES(?,?,?,?)", (name, code, description, now()))
        self.conn.commit(); return cur.lastrowid

    def add_plan(self, project_id, title, file_name="", description="", file_path=""):
        cur = self.conn.execute("INSERT INTO plans(project_id,title,file_name,file_path,description,updated_at) VALUES(?,?,?,?,?,?)", (project_id, title, file_name, file_path, description, now()))
        self.conn.commit(); return cur.lastrowid

    def add_task(self, project_id, plan_id, title, description, assignee, trade, location, priority, status, due_date, tags):
        cur = self.conn.execute("INSERT INTO tasks(project_id,plan_id,title,description,assignee,trade,location,priority,status,due_date,tags,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", (project_id, plan_id, title, description, assignee, trade, location, priority, status, due_date, tags, now(), now()))
        self.conn.commit(); return cur.lastrowid

    def projects(self): return self.conn.execute("SELECT p.*, (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id) task_count, (SELECT COUNT(*) FROM plans pl WHERE pl.project_id=p.id) plan_count FROM projects p ORDER BY p.updated_at DESC").fetchall()
    def project(self, pid): return self.conn.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
    def plans(self, pid): return self.conn.execute("SELECT * FROM plans WHERE project_id=? ORDER BY title", (pid,)).fetchall()
    def plan(self, pid): return self.conn.execute("SELECT * FROM plans WHERE id=?", (pid,)).fetchone()
    def tasks(self, pid=None, search=""):
        q = "SELECT t.*, p.title plan_title FROM tasks t LEFT JOIN plans p ON p.id=t.plan_id WHERE 1=1"; args=[]
        if pid: q += " AND t.project_id=?"; args.append(pid)
        if search: q += " AND (t.title LIKE ? OR t.assignee LIKE ? OR t.trade LIKE ?)"; args += [f"%{search}%"]*3
        return self.conn.execute(q + " ORDER BY CASE t.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, t.due_date", args).fetchall()
    def update_task_status(self, tid, status):
        task = self.conn.execute("SELECT title FROM tasks WHERE id=?", (tid,)).fetchone()
        self.conn.execute("UPDATE tasks SET status=?, updated_at=? WHERE id=?", (status, now(), tid))
        if status == "done" and task:
            self.conn.execute("INSERT INTO notifications(title,body,created_at) VALUES(?,?,?)", ("Task completed", f"{task['title']} was marked complete.", now()))
        self.conn.commit()

    def delete_task(self, tid):
        self.conn.execute("DELETE FROM tasks WHERE id=?", (tid,)); self.conn.commit()

    def delete_project(self, pid):
        self.conn.execute("DELETE FROM projects WHERE id=?", (pid,)); self.conn.commit()

    def add_notification(self, title, body):
        self.conn.execute("INSERT INTO notifications(title,body,created_at) VALUES(?,?,?)", (title, body, now())); self.conn.commit()
    def markups(self, plan_id): return self.conn.execute("SELECT * FROM markups WHERE plan_id=? ORDER BY id", (plan_id,)).fetchall()
    def add_markup(self, plan_id, kind, x, y, w, h, label=""):
        self.conn.execute("INSERT INTO markups(plan_id,kind,x,y,w,h,label,created_at) VALUES(?,?,?,?,?,?,?,?)", (plan_id,kind,x,y,w,h,label,now())); self.conn.commit()
    def notifications(self): return self.conn.execute("SELECT * FROM notifications ORDER BY created_at DESC").fetchall()


class Card(QFrame):
    def __init__(self, title: str, value: str, subtitle: str, color: str = ACCENT):
        super().__init__(); self.setObjectName("card")
        lay = QVBoxLayout(self); lay.setContentsMargins(18, 16, 18, 16)
        top = QHBoxLayout(); label = QLabel(title.upper()); label.setObjectName("eyebrow"); top.addWidget(label); top.addStretch()
        dot = QLabel("●"); dot.setStyleSheet(f"color:{color}; font-size:18px"); top.addWidget(dot); lay.addLayout(top)
        val = QLabel(value); val.setObjectName("metric"); lay.addWidget(val)
        sub = QLabel(subtitle); sub.setObjectName("muted"); lay.addWidget(sub)


class TaskDialog(QDialog):
    def __init__(self, db: Database, project_id: int, parent=None):
        super().__init__(parent); self.db = db; self.project_id = project_id
        self.setWindowTitle("Create task"); self.setMinimumWidth(460)
        form = QFormLayout(self)
        self.title = QLineEdit(); self.title.setPlaceholderText("e.g. Verify door hardware")
        self.description = QTextEdit(); self.description.setFixedHeight(70)
        self.assignee = QLineEdit("Unassigned"); self.trade = QLineEdit("General")
        self.location = QLineEdit(); self.priority = QComboBox(); self.priority.addItems(["P1", "P2", "P3"])
        self.status = QComboBox(); self.status.addItems(["open", "in_progress", "blocked", "done"])
        self.due = QLineEdit((date.today() + timedelta(days=7)).isoformat()); self.tags = QLineEdit()
        self.plan = QComboBox(); self.plan.addItem("No linked plan", None)
        for p in db.plans(project_id): self.plan.addItem(p["title"], p["id"])
        for label, widget in [("Title *", self.title), ("Description", self.description), ("Assignee", self.assignee), ("Trade", self.trade), ("Location", self.location), ("Plan", self.plan), ("Priority", self.priority), ("Status", self.status), ("Due date", self.due), ("Tags", self.tags)]: form.addRow(label, widget)
        buttons = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel); buttons.accepted.connect(self.accept); buttons.rejected.connect(self.reject); form.addRow(buttons)

    def accept(self):
        if not self.title.text().strip(): QMessageBox.warning(self, "Missing title", "Please enter a task title."); return
        self.db.add_task(self.project_id, self.plan.currentData(), self.title.text().strip(), self.description.toPlainText().strip(), self.assignee.text().strip(), self.trade.text().strip(), self.location.text().strip(), self.priority.currentText(), self.status.currentText(), self.due.text().strip(), self.tags.text().strip()); super().accept()


class PlanCanvas(QGraphicsView):
    def __init__(self, db: Database, plan_id: int):
        super().__init__(); self.db = db; self.plan_id = plan_id; self.scene = QGraphicsScene(self); self.setScene(self.scene); self.setMinimumHeight(520); self.setRenderHint(QPainter.Antialiasing); self.setBackgroundBrush(QColor("#e8edf2")); self.active_tool = "pin"; self.refresh()
    def refresh(self):
        self.scene.clear(); self.scene.setSceneRect(0, 0, 760, 520)
        paper = self.scene.addRect(QRectF(90, 30, 580, 450), QPen(QColor("#cbd5e1")), QBrush(QColor("#ffffff")))
        paper.setZValue(-2)
        for x in range(160, 650, 80): self.scene.addLine(x, 30, x, 480, QPen(QColor("#edf1f5")))
        for y in range(100, 480, 80): self.scene.addLine(90, y, 670, y, QPen(QColor("#edf1f5")))
        text = self.scene.addText("PLAN VIEW  •  " + (self.db.plan(self.plan_id)["title"] or "Drawing"), QFont("Arial", 10, QFont.Bold)); text.setPos(105, 42); text.setDefaultTextColor(QColor(NAVY))
        for m in self.db.markups(self.plan_id): self.draw_markup(m)
    def draw_markup(self, m):
        x, y, w, h = 90+m["x"]*580, 30+m["y"]*450, m["w"]*580, m["h"]*450; pen = QPen(QColor(ACCENT if m["kind"] != "task" else "#d94b4b"), 3)
        if m["kind"] in ("rectangle", "task"): item = self.scene.addRect(QRectF(x,y,max(w,14),max(h,14)), pen)
        else: item = self.scene.addEllipse(QRectF(x,y,max(w,18),max(h,18)), pen)
        if m["label"]:
            t = self.scene.addText(m["label"], QFont("Arial", 9, QFont.Bold)); t.setPos(x+5,y+5); t.setDefaultTextColor(QColor("#9a4a20"))
    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton and self.active_tool:
            pos = self.mapToScene(event.position().toPoint()); x = max(0,min(1,(pos.x()-90)/580)); y=max(0,min(1,(pos.y()-30)/450)); self.db.add_markup(self.plan_id, self.active_tool, x, y, .06, .05, "New markup"); self.refresh()
        super().mousePressEvent(event)


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__(); self.db = Database(); self.current_project: Optional[int] = None; self.current_plan: Optional[int] = None
        self.setWindowTitle("Thekkedar — Construction Workspace"); self.resize(1280, 800); self.setMinimumSize(1050, 650)
        self.build_ui(); self.show_dashboard()
    def build_ui(self):
        root = QWidget(); self.setCentralWidget(root); layout = QHBoxLayout(root); layout.setContentsMargins(0,0,0,0); layout.setSpacing(0)
        self.sidebar = QFrame(); self.sidebar.setObjectName("sidebar"); self.sidebar.setFixedWidth(238); sl = QVBoxLayout(self.sidebar); sl.setContentsMargins(18,24,18,18)
        brand = QLabel("THEKKEDAR"); brand.setObjectName("brand"); sl.addWidget(brand); sub = QLabel("CONSTRUCTION OPERATIONS"); sub.setObjectName("brandSub"); sl.addWidget(sub); sl.addSpacing(32)
        self.nav = []
        for text, slot in [("▦  Overview", self.show_dashboard), ("▤  Projects", self.show_projects), ("✓  Tasks", self.show_tasks), ("⌗  Plans & Markups", self.show_plans), ("◉  Notifications", self.show_notifications)]:
            b = QPushButton(text); b.setObjectName("navButton"); b.clicked.connect(slot); sl.addWidget(b); self.nav.append(b)
        sl.addStretch(); offline = QLabel("●  LOCAL MODE\n   SQLite workspace"); offline.setObjectName("offline"); sl.addWidget(offline)
        layout.addWidget(self.sidebar)
        main = QWidget(); ml = QVBoxLayout(main); ml.setContentsMargins(30,24,30,30); ml.setSpacing(18)
        header = QHBoxLayout(); self.page_title = QLabel(); self.page_title.setObjectName("pageTitle"); header.addWidget(self.page_title); header.addStretch(); self.user = QLabel("Project Manager  ·  Offline"); self.user.setObjectName("muted"); header.addWidget(self.user); ml.addLayout(header)
        self.stack = QStackedWidget(); ml.addWidget(self.stack); layout.addWidget(main)
        self.dashboard = QWidget(); self.stack.addWidget(self.dashboard); self.projects_page = QWidget(); self.stack.addWidget(self.projects_page); self.tasks_page = QWidget(); self.stack.addWidget(self.tasks_page); self.plans_page = QWidget(); self.stack.addWidget(self.plans_page); self.notif_page = QWidget(); self.stack.addWidget(self.notif_page)
        self.setStyleSheet(STYLES)
    def clear_page(self, page, title):
        while page.layout():
            old = page.layout(); QWidget().setLayout(old)
        page.setLayout(QVBoxLayout()); page.layout().setSpacing(18); self.page_title.setText(title)
    def show_dashboard(self):
        self.clear_page(self.dashboard, "Good morning, Project Manager"); lay=self.dashboard.layout(); lay.addWidget(QLabel("Here’s the latest across your active workspaces."), alignment=Qt.AlignTop)
        projects=self.db.projects(); tasks=self.db.tasks(); active=sum(t["status"] != "done" for t in tasks); overdue=sum(t["due_date"] and t["due_date"] < date.today().isoformat() and t["status"] != "done" for t in tasks)
        cards=QHBoxLayout(); cards.addWidget(Card("Active projects", str(len(projects)), "Across your workspace", "#c9783d")); cards.addWidget(Card("Open tasks", str(active), "Work still in motion", "#3878a8")); cards.addWidget(Card("Blocked", str(sum(t["status"]=="blocked" for t in tasks)), "Needs attention", "#d94b4b")); cards.addWidget(Card("Overdue", str(overdue), "Past target date", "#9567bd")); lay.addLayout(cards)
        split=QSplitter(Qt.Horizontal); left=QFrame(); left.setObjectName("panel"); ll=QVBoxLayout(left); ll.addWidget(QLabel("ACTIVE PROJECTS", objectName="sectionTitle")); forproj=QListWidget();
        for p in projects[:5]:
            it=QListWidgetItem(f"{p['name']}\n{p['code']}   ·   {p['task_count']} tasks   ·   {p['plan_count']} plans"); it.setData(Qt.UserRole,p["id"]); forproj.addItem(it)
        forproj.itemDoubleClicked.connect(lambda item: self.open_project(item.data(Qt.UserRole))); ll.addWidget(forproj); split.addWidget(left)
        right=QFrame(); right.setObjectName("panel"); rl=QVBoxLayout(right); rl.addWidget(QLabel("RECENT TASKS", objectName="sectionTitle")); recent=QListWidget()
        for t in tasks[:6]: recent.addItem(f"{t['priority']}   {t['title']}\n         {t['status'].replace('_',' ').title()}  ·  {t['assignee']}")
        rl.addWidget(recent); split.addWidget(right); lay.addWidget(split)
    def show_projects(self):
        self.clear_page(self.projects_page,"Projects"); lay=self.projects_page.layout(); row=QHBoxLayout(); row.addWidget(QLabel("Manage project workspaces, plans and delivery tasks.")); row.addStretch(); add=QPushButton("+  New project"); add.clicked.connect(self.new_project); row.addWidget(add); lay.addLayout(row)
        table=QTableWidget(0,5); table.setHorizontalHeaderLabels(["PROJECT","CODE","STATUS","TASKS","PLANS"]); table.setSelectionBehavior(QAbstractItemView.SelectRows); table.setEditTriggers(QAbstractItemView.NoEditTriggers); table.horizontalHeader().setStretchLastSection(True); table.setAlternatingRowColors(True)
        for p in self.db.projects():
            r=table.rowCount(); table.insertRow(r); vals=[p["name"],p["code"],p["status"],str(p["task_count"]),str(p["plan_count"])]
            for c,v in enumerate(vals): table.setItem(r,c,QTableWidgetItem(v))
            table.item(r,0).setData(Qt.UserRole,p["id"])
        table.cellDoubleClicked.connect(lambda r,c:self.open_project(table.item(r,0).data(Qt.UserRole))); lay.addWidget(table)
    def new_project(self):
        d=QDialog(self); d.setWindowTitle("New project"); f=QFormLayout(d); name=QLineEdit(); code=QLineEdit(); desc=QTextEdit(); desc.setFixedHeight(70); f.addRow("Name *",name); f.addRow("Code *",code); f.addRow("Description",desc); bb=QDialogButtonBox(QDialogButtonBox.Save|QDialogButtonBox.Cancel); bb.accepted.connect(d.accept); bb.rejected.connect(d.reject); f.addRow(bb)
        if d.exec() and name.text().strip() and code.text().strip(): self.db.add_project(name.text().strip(),code.text().strip(),desc.toPlainText().strip()); self.show_projects()
    def open_project(self,pid): self.current_project=pid; self.show_tasks(pid)
    def show_tasks(self, pid=None):
        if pid: self.current_project=pid
        self.clear_page(self.tasks_page, "Tasks" if not self.current_project else self.db.project(self.current_project)["name"] + " · Tasks"); lay=self.tasks_page.layout(); row=QHBoxLayout(); search=QLineEdit(); search.setPlaceholderText("Search task, assignee or trade…"); row.addWidget(search); row.addStretch(); add=QPushButton("+  Add task"); add.clicked.connect(lambda:self.add_task_dialog(self.current_project or (self.db.projects()[0]["id"] if self.db.projects() else None))); row.addWidget(add); lay.addLayout(row)
        table=QTableWidget(0,7); table.setHorizontalHeaderLabels(["TASK","PRIORITY","STATUS","ASSIGNEE","TRADE","DUE","PLAN"]); table.setSelectionBehavior(QAbstractItemView.SelectRows); table.setEditTriggers(QAbstractItemView.NoEditTriggers); table.horizontalHeader().setStretchLastSection(True); lay.addWidget(table)
        def refresh():
            data=self.db.tasks(self.current_project,search.text()); table.setRowCount(0)
            for t in data:
                r=table.rowCount(); table.insertRow(r); vals=[t["title"],t["priority"],t["status"].replace("_"," ").title(),t["assignee"],t["trade"],t["due_date"],t["plan_title"] or "—"]
                for c,v in enumerate(vals): table.setItem(r,c,QTableWidgetItem(str(v or "")))
                table.item(r,1).setForeground(QColor("#d94b4b" if t["priority"]=="P1" else "#bf7a21" if t["priority"]=="P2" else "#47815e")); table.item(r,0).setData(Qt.UserRole,t["id"])
            table.cellDoubleClicked.connect(lambda r,c:self.task_status_dialog(table.item(r,0).data(Qt.UserRole)))
        actions=QHBoxLayout(); delete=QPushButton("Delete selected task"); delete.clicked.connect(lambda:self.delete_selected_task(table)); actions.addWidget(delete); actions.addStretch(); lay.addLayout(actions)
        search.textChanged.connect(refresh); refresh()
    def export_tasks(self):
        path, _ = QFileDialog.getSaveFileName(self, "Export tasks", "thekkedar_tasks.csv", "CSV files (*.csv)")
        if not path: return
        rows = self.db.tasks(self.current_project)
        with open(path, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f); writer.writerow(["Title","Priority","Status","Assignee","Trade","Location","Due date","Plan","Tags"])
            for t in rows: writer.writerow([t["title"],t["priority"],t["status"],t["assignee"],t["trade"],t["location"],t["due_date"],t["plan_title"] or "",t["tags"]])
        self.db.add_notification("Tasks exported", f"Exported {len(rows)} task(s) to {Path(path).name}.")
        QMessageBox.information(self, "Export complete", f"Saved {len(rows)} tasks to:
{path}")

    def delete_selected_task(self, table):
        row = table.currentRow()
        if row < 0: QMessageBox.information(self, "Select a task", "Select a task row first."); return
        tid = table.item(row, 0).data(Qt.UserRole); title = table.item(row, 0).text()
        if QMessageBox.question(self, "Delete task", f"Delete '{title}'? This cannot be undone.") == QMessageBox.Yes:
            self.db.delete_task(tid); self.show_tasks(self.current_project)

    def add_task_dialog(self,pid):
        if not pid: QMessageBox.information(self,"Create a project first","Add a project before creating tasks."); return
        if TaskDialog(self.db,pid,self).exec(): self.show_tasks(pid)
    def task_status_dialog(self, tid):
        t=self.db.conn.execute("SELECT * FROM tasks WHERE id=?",(tid,)).fetchone(); d=QDialog(self); d.setWindowTitle("Update task"); f=QFormLayout(d); status=QComboBox(); status.addItems(["open","in_progress","blocked","done"]); status.setCurrentText(t["status"]); f.addRow("Status",status); note=QLabel(t["title"]); note.setWordWrap(True); f.addRow("Task",note); bb=QDialogButtonBox(QDialogButtonBox.Save|QDialogButtonBox.Cancel); bb.accepted.connect(d.accept); bb.rejected.connect(d.reject); f.addRow(bb)
        if d.exec(): self.db.update_task_status(tid,status.currentText()); self.show_tasks(self.current_project)
    def show_plans(self):
        self.clear_page(self.plans_page,"Plans & Markups"); lay=self.plans_page.layout(); row=QHBoxLayout(); row.addWidget(QLabel("Import drawings, open source files, and place normalized markups.")); row.addStretch(); add=QPushButton("+  Import plan"); add.clicked.connect(self.import_plan_dialog); row.addWidget(add); lay.addLayout(row)
        split=QSplitter(Qt.Horizontal); listw=QListWidget(); plans=[]
        for p in self.db.projects():
            for plan in self.db.plans(p["id"]): plans.append((p,plan)); it=QListWidgetItem(f"{plan['title']}\n{p['code']}  ·  {plan['file_name'] or 'local drawing'}"); it.setData(Qt.UserRole,plan["id"]); listw.addItem(it)
        split.addWidget(listw); viewer=QFrame(); vl=QVBoxLayout(viewer); self.plan_info=QLabel("Select a plan"); self.plan_info.setObjectName("sectionTitle"); vl.addWidget(self.plan_info); self.canvas_host=QWidget(); vl.addWidget(self.canvas_host); split.addWidget(viewer); lay.addWidget(split)
        def open_plan(item):
            self.current_plan=item.data(Qt.UserRole); plan=self.db.plan(self.current_plan); self.plan_info.setText(plan["title"] + "  ·  Markup mode: click drawing to place"); old=self.canvas_host.layout()
            if old:
                while old.count(): old.takeAt(0).widget().deleteLater()
            lo=QVBoxLayout(self.canvas_host); tools=QHBoxLayout()
            if plan["file_path"] and Path(plan["file_path"]).exists():
                open_src=QPushButton("Open source file"); open_src.clicked.connect(lambda: QDesktopServices.openUrl(QUrl.fromLocalFile(plan["file_path"]))); tools.addWidget(open_src)
            for name in ["pin","rectangle","circle"]:
                b=QPushButton(name.title()); b.clicked.connect(lambda checked=False,n=name: setattr(canvas,"active_tool",n)); tools.addWidget(b)
            tools.addStretch(); lo.addLayout(tools); canvas=PlanCanvas(self.db,self.current_plan); lo.addWidget(canvas)
        listw.itemClicked.connect(open_plan)
    def import_plan_dialog(self):
        projects = self.db.projects()
        if not projects: QMessageBox.information(self, "Create a project first", "Create a project before importing a plan."); return
        source, _ = QFileDialog.getOpenFileName(self, "Select plan file", "", "Plans (*.pdf *.png *.jpg *.jpeg *.webp);;All files (*.*)")
        if not source: return
        d=QDialog(self); d.setWindowTitle("Import plan"); f=QFormLayout(d); project=QComboBox();
        for p in projects: project.addItem(f"{p['name']} ({p['code']})", p['id'])
        title=QLineEdit(Path(source).stem); desc=QTextEdit(); desc.setFixedHeight(70); f.addRow("Project",project); f.addRow("Title",title); f.addRow("Description",desc); bb=QDialogButtonBox(QDialogButtonBox.Save|QDialogButtonBox.Cancel); bb.accepted.connect(d.accept); bb.rejected.connect(d.reject); f.addRow(bb)
        if d.exec() and title.text().strip():
            target_dir=APP_DIR / "plans"; target_dir.mkdir(parents=True, exist_ok=True); target=target_dir / f"{datetime.now().strftime('%Y%m%d%H%M%S')}_{Path(source).name}"; shutil.copy2(source,target)
            self.db.add_plan(project.currentData(), title.text().strip(), Path(source).name, desc.toPlainText().strip(), str(target)); self.db.add_notification("Plan imported", f"{title.text().strip()} was added to the workspace."); self.show_plans()

    def show_notifications(self):
        self.clear_page(self.notif_page,"Notifications"); lay=self.notif_page.layout(); lay.addWidget(QLabel("Assignments, comments and delivery updates from your workspace.")); lst=QListWidget();
        for n in self.db.notifications(): lst.addItem(f"{n['title']}\n{n['body'] or ''}  ·  {n['created_at']}")
        lay.addWidget(lst)


STYLES = f"""
* {{ font-family: 'Segoe UI', Arial; color: {NAVY}; }}
QMainWindow, QWidget {{ background: {BG}; }}
#sidebar {{ background: {NAVY}; }}
#brand {{ color: white; font-size: 22px; font-weight: 800; letter-spacing: 2px; }}
#brandSub {{ color: #8ea4b8; font-size: 9px; letter-spacing: 1.2px; }}
#navButton {{ color: #b6c7d5; text-align: left; border: 0; padding: 12px 14px; border-radius: 7px; font-size: 13px; }}
#navButton:hover {{ background: #234564; color: white; }}
#offline {{ color: #9ac5a3; font-size: 11px; padding: 10px 2px; }}
#pageTitle {{ font-size: 25px; font-weight: 700; color: {NAVY}; }}
#muted {{ color: {MUTED}; font-size: 12px; }}
#card, #panel {{ background: white; border: 1px solid #e5eaf0; border-radius: 10px; }}
#card {{ min-width: 155px; }}
#eyebrow, #sectionTitle {{ color: {MUTED}; font-size: 10px; font-weight: 700; letter-spacing: 1px; }}
#metric {{ font-size: 30px; font-weight: 700; color: {NAVY}; }}
QPushButton {{ background: {ACCENT}; color: white; border: 0; padding: 10px 16px; border-radius: 6px; font-weight: 600; }}
QPushButton:hover {{ background: #ac5f2e; }}
QLineEdit, QTextEdit, QComboBox {{ background: white; border: 1px solid #d9e0e7; border-radius: 6px; padding: 8px; }}
QListWidget, QTableWidget {{ background: white; border: 1px solid #e5eaf0; border-radius: 8px; alternate-background-color: #f8fafc; }}
QListWidget::item {{ padding: 12px; border-bottom: 1px solid #edf1f5; }}
QHeaderView::section {{ background: #eef2f6; color: {MUTED}; padding: 10px; border: 0; font-size: 10px; font-weight: 700; }}
"""


def main():
    app = QApplication(sys.argv); app.setApplicationName("Thekkedar")
    win = MainWindow(); win.show(); sys.exit(app.exec())


if __name__ == "__main__": main()
