import urllib.request, zipfile, os, sys, tempfile

URL = "https://github.com/brechtsanders/winlibs_mingw/releases/download/16.2.0posix-14.0.0-ucrt-r1/winlibs-x86_64-posix-seh-gcc-16.2.0-mingw-w64ucrt-14.0.0-r1.zip"

# 去本地化（2026-09-28）：原先写死 E:\mingw64.zip / E:\mingw64。
#   · 压缩包 → 系统临时目录，用完即弃；
#   · 解压目标 → 环境变量 LAB_MINGW_DIR，否则放**仓内** .toolchains\mingw64（已被 .gitignore 忽略）。
_HERE = os.path.dirname(os.path.abspath(__file__))
ZIP = os.path.join(tempfile.gettempdir(), "mingw64.zip")
DEST = os.environ.get("LAB_MINGW_DIR") or os.path.join(
    os.path.dirname(_HERE), ".toolchains", "mingw64")

print("[1/3] downloading ...", flush=True)
req = urllib.request.Request(URL, headers={"User-Agent": "workbuddy"})
with urllib.request.urlopen(req, timeout=120) as resp, open(ZIP, "wb") as f:
    total = int(resp.headers.get("Content-Length", "0"))
    got = 0
    while True:
        chunk = resp.read(1024 * 1024)
        if not chunk:
            break
        f.write(chunk)
        got += len(chunk)
        if total:
            print(f"  {got*100//total}%", end="\r", flush=True)
print(f"\n[2/3] downloaded {got} bytes, extracting to {DEST} ...", flush=True)
os.makedirs(DEST, exist_ok=True)
with zipfile.ZipFile(ZIP) as z:
    z.extractall(DEST)
print("[3/3] done. g++ at", os.path.join(DEST, "bin", "g++.exe"), flush=True)
print("GPP_OK", flush=True)
