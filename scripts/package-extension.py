from pathlib import Path
import json
import shutil
import zipfile

root = Path(__file__).resolve().parent.parent
source = root / "browser-extension"
version = json.loads((source / "manifest.json").read_text(encoding="utf-8"))["version"]
output = root / "release"
name = f"MCPWindow-Companion-{version}"
destination = output / name
files = [
    "manifest.json",
    "background.js",
    "content.js",
    "popup.html",
    "popup.js",
    "styles.css",
    "mcp.js",
    "config-parser.js",
    "interactions.js",
    "logs.js",
    "charts.js",
    "icon.png",
    "README.md",
]

output.mkdir(parents=True, exist_ok=True)
if destination.exists():
    shutil.rmtree(destination)
destination.mkdir()
for filename in files:
    shutil.copy2(source / filename, destination / filename)

archive = output / f"{name}.zip"
archive.unlink(missing_ok=True)
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
    for filename in files:
        bundle.write(destination / filename, arcname=f"{name}/{filename}")
print(archive)
