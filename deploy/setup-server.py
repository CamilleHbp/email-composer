#!/usr/bin/env python3
"""Prepare the dedicated database and protected environment on HomeServer."""
import os
from pathlib import Path
import secrets
import subprocess
import sys

root = Path("/home/debian/HomeServer/apps/mail-studio")
root.mkdir(parents=True, exist_ok=True, mode=0o750)
env_path = root / ".env"
email = sys.argv[1]
if "\n" in email or "@" not in email:
    raise ValueError("Provide the initial administrator email address")


def run(args, data=None):
    result = subprocess.run(args, input=data, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(f"Command failed: {args[0]} (exit {result.returncode})")
    return result.stdout


def psql(statement):
    return run(["docker", "exec", "-i", "homeserver-postgres-1", "psql", "-U", "postgres",
                "-v", "ON_ERROR_STOP=1", "-At"], statement).strip()


if not env_path.exists():
    if psql("SELECT rolname FROM pg_roles WHERE rolname='mail_studio';"):
        raise RuntimeError("Existing role without deployment environment; inspect before continuing")
    password = secrets.token_urlsafe(36)
    values = {
        "NODE_ENV": "production",
        "PUBLIC_ORIGIN": "https://mail-studio.camille.studio",
        "DATABASE_URL": f"postgres://mail_studio:{password}@postgres:5432/mail_studio",
        "BETTER_AUTH_SECRET": secrets.token_urlsafe(48),
        "S3_ENDPOINT": "https://s3.fr-par.scw.cloud",
        "S3_REGION": "fr-par",
        "S3_BUCKET": "mail-studio",
        "ASSET_PUBLIC_BASE_URL": "https://mail-studio.s3.fr-par.scw.cloud",
        "ADMIN_EMAIL": email,
        "ADMIN_NAME": "Camille",
        "MAIL_STUDIO_IMAGE": "mail-studio:0.1.0-20261020",
    }
    fd = os.open(env_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as output:
        output.write("".join(f"{key}={value}\n" for key, value in values.items()))
else:
    values = dict(line.split("=", 1) for line in env_path.read_text().splitlines()
                  if line and not line.startswith("#") and "=" in line)
    password = values["DATABASE_URL"].split(":", 2)[2].split("@", 1)[0]
    if not all(c.isalnum() or c in "_-" for c in password):
        raise RuntimeError("Unexpected database credential format")

if not psql("SELECT rolname FROM pg_roles WHERE rolname='mail_studio';"):
    psql(f"CREATE ROLE mail_studio LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '{password}';")
if not psql("SELECT datname FROM pg_database WHERE datname='mail_studio';"):
    psql("CREATE DATABASE mail_studio OWNER mail_studio;")
    psql("REVOKE ALL ON DATABASE mail_studio FROM PUBLIC;")
run(["docker", "run", "--rm", "--network", "homeserver-database",
     "--env-file", str(env_path), values["MAIL_STUDIO_IMAGE"],
     "node", "dist/server/manage.js", "migrate"])
print("Dedicated database and migrations ready; protected environment saved. Application not started.")
