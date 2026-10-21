# Mail Studio

An invitation-only email composer with nested layouts, reusable templates and
sections, English/French interfaces, and Scaleway-hosted images.

Independent codebase under the [MIT license](LICENSE). MySigMail and KettleMail
are product references; their source code is not included.

## Development

Requires Node.js 24+ and Bun or npm. To run locally without external services:

```sh
bun install
bun run dev
```

Open http://localhost:5173 and sign in with `test@example.test` /
`test-password-12345`. Press **Ctrl+C** in the same terminal to stop both the UI
and API. Run the same command again to resume. `npm install` and `npm run dev`
also work.

The local environment creates its own database and image storage in `.local/`,
which is excluded from Git and Docker builds. Drafts, images, and login sessions
survive restarts. Frontend edits update live; restart the command after backend
changes. Local development does not require `.env` and uses no Scaleway services.
Published image URLs in local exports work only while this local server is running
on your computer.

To develop against PostgreSQL and a dedicated Scaleway Object Storage bucket,
configure `.env` and use the separate service-backed command:

```sh
npm ci
cp .env.example .env
# Configure the database, auth secret, and Scaleway credentials in .env.
npm run db:migrate
npm run admin:create
npm run dev:services
```

`admin:create` reads `ADMIN_EMAIL` and `ADMIN_NAME` and prints a one-hour
password-setup link. Keep that link private. Administrators generate invitation
and recovery links in **People & access**. Public signup is disabled.

The app uses `http://localhost:5173` in development. `PUBLIC_ORIGIN` must match the
browser origin exactly. Do not commit `.env` or put storage keys in Vite variables.

## Email workflows

- **Copy formatted email** is the primary workflow. Preview shows the same
  copyable layout. Copy it and paste into the body of a new Proton Mail message,
  then enter the subject separately. Referenced images use permanent hosted links.
  Clipboard permissions are browser-controlled; a manual selection fallback is
  available. File downloads are available under **Other formats**.
- **HTML** exports use permanent public image URLs.
- **Embedded email** exports a MIME `.eml` file with CID image attachments without
  publishing the images. Opening it as an editable draft depends on the mail app.
- **Template archive** exports JSON and assets in a portable ZIP for re-import.

Uploads support PNG, JPEG, WebP and GIF up to 10 MB. Images are normalized to PNG,
metadata is removed, and dimensions are limited to 2400 pixels. Animated uploads
use their first frame. Nested layouts allow up to eight levels and 500 blocks.
Rich text supports bold, italics, underline and line breaks. Links are configured
on buttons and images.

Embedded email and archive exports allow up to 100 images and 40 MB of image
data. Hosted HTML and clipboard exports use image URLs instead of embedding the
image data.

Removing a populated column moves its content into a neighboring column.
Deleting a template does not revoke its published images. Revocation is explicit;
already cached images cannot be recalled. Re-exporting a revoked image creates a
new URL.

## Scaleway

Use one **dedicated** bucket, with `private/` and `published/` prefixes. Never apply
the provisioning command to a bucket shared with another application.

- `S3_ENDPOINT`: e.g. `https://s3.fr-par.scw.cloud`
- `S3_REGION`: defaults to `fr-par`
- `S3_BUCKET`: dedicated bucket name
- `ASSET_PUBLIC_BASE_URL`: e.g. `https://BUCKET.s3.fr-par.scw.cloud`
- `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`: runtime application credentials

Provision the bucket once using an identity authorized to change bucket policies,
versioning and lifecycle rules. Set `S3_APPLICATION_ID` to the runtime
application's ID, `S3_PROVISIONER_PRINCIPAL` to the provisioning identity
(`user_id:UUID` or `application_id:UUID`), and `CONFIRM_DEDICATED_BUCKET` to the
exact bucket name. The administrative principal retains bucket-management access.
Then run:

```sh
npm run storage:configure
npm run storage:verify
```

The policy grants anonymous reads only to `published/*`, with no anonymous listing
or writes. Runtime credentials need only object operations and bucket listing,
not policy administration. Replace provisioning credentials with runtime
credentials afterward.

The runtime application's IAM policy needs `ObjectStorageObjectsRead`,
`ObjectStorageObjectsWrite`, `ObjectStorageObjectsDelete`, and
`ObjectStorageBucketsRead`, scoped to the selected project. Scaleway evaluates
these project-wide IAM permissions together with each bucket's policy. Other
buckets added to the same project must have explicit restrictive policies to
exclude this application; a separate project provides stronger isolation.
The Mail Studio bucket policy does not allow the runtime application to delete
historical object versions or change bucket configuration.

Versioning retains noncurrent versions for 30 days. Current images never expire
automatically or transition to Glacier. The verification command uses temporary
objects to check privacy, anonymous restrictions, publication, revocation, and
version recovery. Run it with credentials that can inspect bucket configuration.

Uploads pass through the authenticated API, so direct browser-to-bucket uploads
and bucket CORS configuration are unnecessary.

## Checks

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Integration tests use in-process PostgreSQL (PGlite) and a storage test double.
Browser tests run a separate temporary database and actual authentication/API
flows. They do not validate Scaleway permissions or real email clients.

Before a release, copy a nested, image-containing fixture into Infomaniak and
Gmail, send it to controlled test inboxes, and inspect the received messages at
desktop/mobile widths. Open the embedded email in Apple Mail and verify the
images remain present without remote image access. Browser previews alone cannot
prove those behaviors.

## Deployment

See [deployment instructions](deploy/README.md). The Docker image serves the UI
and API. All durable application state lives in PostgreSQL and Scaleway.
