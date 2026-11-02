# PyInstaller build of the local server (§2, §13): `uv run pyinstaller aiplot-server.spec`
# -> dist/aiplot-server/ (one folder: aiplot-server.exe + _internal/). electron-builder copies
# it to resources/aiplot-server/.
#
# The server finds its files beside the aiplot package (aiplot/llm/config.py: SERVER_DIR is
# two levels above aiplot/llm), which in the bundle is _internal/: config/, prompts/ and data/
# go there, and the migrations stay inside aiplot/db/. The fixture LLM's answers go too, so
# the packaged app can be checked with AIPLOT_FAKE_LLM=1.
from PyInstaller.utils.hooks import collect_submodules

datas = [
    ("config", "config"),
    ("prompts", "prompts"),
    ("data", "data"),
    ("aiplot/db/migrations", "aiplot/db/migrations"),
    ("tests/fixtures/llm", "tests/fixtures/llm"),
]

a = Analysis(
    ["packaging/entry.py"],
    pathex=["."],
    datas=datas,
    # uvicorn picks its loop, protocol and logging classes by name at run time.
    hiddenimports=collect_submodules("uvicorn"),
    excludes=["tkinter"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="aiplot-server",
    console=True,
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="aiplot-server", upx=False)
