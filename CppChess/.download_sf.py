import urllib.request, py7zr, os, time

URL = ("https://sourceforge.net/projects/mingw-w64/files/Toolchains%20targetting%20Win64/"
       "Personal%20Builds/mingw-builds/8.1.0/threads-posix/seh/"
       "x86_64-8.1.0-release-posix-seh-rt_v6-rev0.7z/download")
ZIP = r"E:\mingw64.7z"
DEST = r"E:\mingw64"

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
