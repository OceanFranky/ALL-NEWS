import os
import pathlib
import re
import sys

root = sys.argv[1]
release_name = sys.argv[2]
if not re.fullmatch(r"/[A-Za-z0-9/_.-]+", root):
    raise ValueError("Use an absolute deployment path without spaces")
if not re.fullmatch(r"[A-Za-z0-9_.-]+", release_name):
    raise ValueError("Use a single release directory name")
runtime = f"{root}/runtime"
node = f"{runtime}/node-v24.22.0-linux-x64/bin/node"
postgres = f"{runtime}/postgres/bin"
release = f"{root}/releases/{release_name}"
directory = pathlib.Path.home() / ".config/systemd/user"
services = {
    "postgres": (f"{root}", f"{postgres}/postgres -D {root}/pgdata -h 127.0.0.1 -p 15432 -k {root}/pgsocket", "", 90),
    "api": (release, f"{node} --env-file={root}/server.env apps/api/src/main.ts", "all-news-postgres.service", 90),
    "worker": (release, f"{node} --env-file={root}/server.env apps/worker/src/main.ts", "all-news-postgres.service", 240),
    "web": (release, f"{node} --env-file={root}/web.env apps/web/server.ts", "all-news-api.service", 90),
}
for name in services:
    if (directory / f"all-news-{name}.service").exists():
        raise FileExistsError(f"all-news-{name}.service already exists; inspect before replacing")
directory.mkdir(parents=True, exist_ok=True)
for name, (working_directory, command, after, timeout) in services.items():
    text = f"""[Unit]
Description=ALL-NEWS {name}
After={after}

[Service]
Type=simple
WorkingDirectory={working_directory}
Environment=PATH={postgres}:{runtime}/node-v24.22.0-linux-x64/bin:/usr/local/bin:/usr/bin:/bin
Environment=TMPDIR={root}/tmp
ExecStart={command}
Restart=on-failure
RestartSec=5
TimeoutStopSec={timeout}
UMask=0077
NoNewPrivileges=true
StandardOutput=append:{root}/logs/{name}.log
StandardError=append:{root}/logs/{name}.log

[Install]
WantedBy=default.target
"""
    path = directory / f"all-news-{name}.service"
    path.write_text(text)
    os.chmod(path, 0o600)
print("Four dedicated user service units installed; not started.")
