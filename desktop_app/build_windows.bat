@echo off
setlocal
cd /d "%~dp0"

python -m pip install -r requirements.txt
python -m pip install pyinstaller
pyinstaller --noconfirm --clean --windowed --name Thekkedar --collect-all PySide6 main.py

echo.
echo Build complete: dist\Thekkedar\Thekkedar.exe
pause
