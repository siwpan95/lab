import urllib.request, py7zr, os, time, tempfile

URL = ("https://sourceforge.net/projects/mingw-w64/files/Toolchains%20targetting%20Win64/"
       "Personal%20Builds/mingw-builds/8.1.0/threads-posix/seh/"
       "x86_64-8.1.0-release-posix-seh-rt_v6-rev0.7z/download")

# 去本地化（2026-09-28）：原先写死 E:\mingw64.7z / E:\mingw64。
#   · 压缩包 → 系统临时目录；解压目标 → LAB_MINGW_DIR，否则仓内 .toolchains\mingw64。
_HERE = os.path.dirname(os.path.abspath(__file__))
ZIP = os.path.join(tempfile.gettempdir(), "mingw64.7z")
DEST = os.environ.get("LAB_MINGW_DIR") or os.path.join(
    os.path.dirname(_HERE), ".toolchains", "mingw64")

print("[1/3] downloading MinGW-builds (SourceForge) ...", flush=True)
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
            print(f"  {got*100//total}%  {got//1024//1024}MB/{total//1024//1024}MB", end="\r", flush=True)
print(f"\n[2/3] downloaded {got} bytes, extracting to {DEST} ...", flush=True)
os.makedirs(DEST, exist_ok=True)
with py7zr.SevenZipFile(ZIP, 'r') as z:
    z.extractall(path=DEST)
gpp = os.path.join(DEST, "bin", "g++.exe")
print("[3/3] done. g++ at", gpp, "exists:", os.path.exists(gpp), flush=True)
print("GPP_OK", flush=True)
