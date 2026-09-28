import urllib.request, zipfile, os, sys

URL = "https://github.com/brechtsanders/winlibs_mingw/releases/download/16.2.0posix-14.0.0-ucrt-r1/winlibs-x86_64-posix-seh-gcc-16.2.0-mingw-w64ucrt-14.0.0-r1.zip"
ZIP = r"E:\mingw64.zip"
DEST = r"E:\mingw64"

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
