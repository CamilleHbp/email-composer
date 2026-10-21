#!/usr/bin/env python3
"""Verify an already-built image against a temporary DB on HomeServer PostgreSQL."""
import http.cookiejar
import json
import os
import secrets
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
import uuid

image = os.environ.get("MAIL_STUDIO_IMAGE", "mail-studio:0.1.0")
postgres = os.environ.get("POSTGRES_CONTAINER", "homeserver-postgres-1")
identifier = "mail_studio_verify_" + secrets.token_hex(4)
restored = identifier + "_restore"
password = secrets.token_urlsafe(32)
origin = "http://127.0.0.1:3317"
env_path = None
created_role = False
created_db = False
created_restore = False
started = False


def command(args, data=None):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.replace(password, "[redacted]"))
    return result.stdout + (result.stderr if args[:2] == ["docker", "logs"] else "")


def psql(statement, database="postgres"):
    return command(["docker", "exec", "-i", postgres, "psql", "-U", "postgres",
                    "-d", database, "-v", "ON_ERROR_STOP=1", "-At"], statement)


try:
    psql(f'CREATE ROLE "{identifier}" LOGIN PASSWORD \'{password}\';')
    created_role = True
    psql(f'CREATE DATABASE "{identifier}" OWNER "{identifier}";')
    created_db = True
    env = {
        "NODE_ENV": "production", "PUBLIC_ORIGIN": origin,
        "DATABASE_URL": f"postgres://{identifier}:{password}@postgres:5432/{identifier}",
        "BETTER_AUTH_SECRET": secrets.token_urlsafe(48),
        # The smoke fixture has no images; real S3 verification is a separate gate.
        "S3_BUCKET": "smoke-unused", "S3_ACCESS_KEY_ID": "smoke-unused",
        "S3_SECRET_ACCESS_KEY": "smoke-unused",
        "ASSET_PUBLIC_BASE_URL": "https://smoke-unused.s3.fr-par.scw.cloud",
        "ADMIN_EMAIL": "verify@example.test", "ADMIN_NAME": "Verification",
    }
    fd, env_path = tempfile.mkstemp(prefix="mail-studio-verify-", dir="/srv/homeserver/builds")
    with os.fdopen(fd, "w") as output:
        output.write("\n".join(f"{key}={value}" for key, value in env.items()) + "\n")
    base = ["docker", "run", "--rm", "--network", "homeserver-database", "--env-file", env_path]
    command(base + [image, "node", "dist/server/manage.js", "migrate"])
    link = command(base + [image, "node", "dist/server/manage.js", "admin"]).strip()
    token = urllib.parse.parse_qs(urllib.parse.urlparse(link).query)["token"][0]
    command(["docker", "create", "--name", identifier, "--network", "homeserver-web",
             "--env-file", env_path, "--read-only", "--tmpfs", "/tmp:size=64m",
             "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
             "--memory", "768m", "-p", "127.0.0.1:3317:3000", image])
    started = True
    command(["docker", "network", "connect", "homeserver-database", identifier])
    command(["docker", "start", identifier])
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(path, data=None):
        req = urllib.request.Request(origin + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers={"Origin": origin, "Content-Type": "application/json"})
        with opener.open(req, timeout=15) as response:
            return response.read()

    for attempt in range(30):
        try:
            request("/healthz")
            break
        except Exception:
            running = command(["docker", "inspect", "--format", "{{.State.Running}}", identifier]).strip()
            if running != "true":
                logs = command(["docker", "logs", identifier])
                for secret in (password, env["BETTER_AUTH_SECRET"]):
                    logs = logs.replace(secret, "[redacted]")
                raise RuntimeError("Container stopped during startup: " + logs)
            if attempt == 29:
                raise
            time.sleep(1)
    request("/api/redeem", {"token": token, "name": "Verification", "password": password})
    request("/api/auth/sign-in/email", {"email": "verify@example.test", "password": password})
    assert json.loads(request("/api/me"))["role"] == "admin"
    document = {"version": 1, "subject": "Smoke test", "preheader": "",
                "width": 640, "background": "#ffffff", "nodes": []}
    record = json.loads(request("/api/templates", {"name": "Container verification",
                        "kind": "draft", "document": document}))
    assert record["revision"] == 1
    eml = request("/api/exports", {"format": "eml", "document": document})
    assert b"Subject: Smoke test" in eml and b"X-Unsent: 1" in eml
    assert b"Mail Studio" in request("/")
    dump = command(["docker", "exec", postgres, "pg_dump", "-U", "postgres", "-d", identifier])
    psql(f'CREATE DATABASE "{restored}" OWNER "{identifier}";')
    created_restore = True
    psql(dump, restored)
    assert psql("SELECT count(*) FROM templates;", restored).strip() == "1"
    print("PASS: container startup, migrations, account setup, sign-in, template storage, EML export, static UI, database backup/restore.")
finally:
    if started:
        command(["docker", "rm", "-f", identifier])
    if created_restore:
        psql(f'DROP DATABASE "{restored}";')
    if created_db:
        psql(f'DROP DATABASE "{identifier}";')
    if created_role:
        psql(f'DROP ROLE "{identifier}";')
    if env_path and os.path.exists(env_path):
        os.unlink(env_path)
