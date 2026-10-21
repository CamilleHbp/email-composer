# Infomaniak deployment

Mail Studio uses the existing Caddy and PostgreSQL services. Do not create another
production PostgreSQL container.

1. Inspect `ssh nf-showcases`, `/home/debian/HomeServer`, running services, disk
   capacity, Docker networks, and the current Caddy configuration.
2. Configure `mail-studio.camille.studio` DNS to the server.
3. Build the Docker image from this repository:

   ```sh
   docker build -t mail-studio:0.1.0 .
   ```

   On the server, put build sources under `/srv/homeserver/builds/mail-studio`.
   Keep the previous image under an immutable release tag for rollback.

4. Create a dedicated `mail_studio` PostgreSQL database and login role using a
   randomly generated password. Grant the role ownership only of that database.
   Use `postgres:5432` over `homeserver-database`.
   `setup-server.py ADMIN_EMAIL` can prepare this database, its migrations, and a
   mode-0600 environment file on the server. It generates database and session
   secrets on the server and does not start the application. Add the restricted
   storage credentials before starting it.
5. Place `compose.yaml` and a mode-0600 `.env` in
   `/home/debian/HomeServer/apps/mail-studio`. Set the production database URL,
   auth secret, Scaleway settings, and
   `PUBLIC_ORIGIN=https://mail-studio.camille.studio`.
6. Run migrations and create the initial account:

   ```sh
   docker compose run --rm mail-studio node dist/server/manage.js migrate
   docker compose run --rm mail-studio node dist/server/manage.js admin
   docker compose up -d mail-studio
   ```

7. Add the supplied hostname block to the existing Caddyfile. Validate it inside
   Caddy, then reload Caddy; do not restart unrelated applications.
   If the installed Caddy version does not support signal-based reloads and has
   `admin off`, a reload is unavailable. Preserve that security setting, validate
   the complete configuration first, then restart only Caddy to load the route.
   This briefly affects HTTPS routing; application containers stay running.
8. Verify `/healthz`, HTTPS, sign-in, invitation redemption, template persistence,
   private image access, public image URLs, and all export types.
9. Run the HomeServer PostgreSQL backup and the Scaleway storage verification.

Before production configuration, the built image can be checked against isolated
temporary databases on the existing PostgreSQL service:

```sh
ssh nf-showcases 'python3 -' < deploy/smoke.py
```

This checks migrations, initial account setup, sign-in, template persistence,
embedded email export, static file serving, and a database dump/restore. It
removes its temporary databases, role, container, and environment file. It uses
port 3317 on server loopback and does not exercise Scaleway; run
`storage:verify` separately with the actual dedicated bucket.

After HTTPS and storage are configured, run the production fixture:

```sh
ssh nf-showcases 'docker exec -e CONFIRM_LIVE_CHECK=mail-studio -i mail-studio-mail-studio-1 node --input-type=module -' < deploy/live-check.mjs
```

It creates a disposable account and generated image, exercises sign-in, nested
draft persistence, private previews, embedded email, archive import, public
clipboard images and revocation, then removes its records and current objects.
The bucket's lifecycle retains historical test-object versions for 30 days.
Run bucket policy and version recovery verification with the provisioning
identity; the application identity deliberately cannot administer the bucket or
read historical versions.

## Recovery

The existing cluster backup includes the dedicated database. Restore it into a
separate recovery database first, using the existing PostgreSQL service. Start an
isolated instance with that database and confirm templates and asset references
before replacing production state.

For an accidentally deleted or overwritten object, list its versions and retrieve
the intended version by ID. Restore it to the original key only when that key
should remain accessible. Do not restore explicitly revoked public images.
Bucket versions provide a bounded 30-day recovery window, not an independent
backup against loss of the Scaleway account. Portable archives provide per-design
exports independent of the service.

## Rollback

Keep the prior image tag and a pre-migration database backup. Change
`MAIL_STUDIO_IMAGE` and recreate only `mail-studio`. Review migration compatibility
before rolling code backward; restore a database backup only when necessary and
after preserving subsequent user data.

## Resource limits

The application has a 768 MB memory limit, a 64 MB temporary filesystem, restricted
capabilities, and rotated logs. Images are stored solely in Scaleway; no image
volume is mounted. Published images are delivered directly by Scaleway.
