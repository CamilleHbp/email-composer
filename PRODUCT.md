# Mail Studio
<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
React, TypeScript, Vite, Fastify, Drizzle, PostgreSQL, Better Auth, MJML.
One application container on Infomaniak, behind existing Caddy.
Scaleway Object Storage holds images; no persistent local image volume.

## Users
Invited users composing email in Infomaniak webmail, Gmail, and Apple Mail.
Administrators invite users and curate shared starter templates.

## Product Purpose
Create flexible email layouts, reuse templates and sections, and transfer finished
emails into existing mail applications.

## Capabilities and Constraints
Nested rows and columns, cross-container moves, alignment and mobile stacking.
Personal collections and administrator-curated shared templates.
Formatted copy publishes permanent image URLs. EML export embeds private images.
No direct sending, mailbox credentials, AI, editable source, or live collaboration.
Independent implementation; reference projects are not code dependencies.

## Accessibility & Inclusion
Complete English/French interfaces with automatic and persistent language choices.
Keyboard alternatives to dragging, visible focus, labeled controls.

## Brand Commitments
Mail Studio, hosted at mail-studio.camille.studio.

## Product Principles
Preserve user content. Make layout operations reversible.
Keep draft assets private and publish only for hosted-image exports.
Verify real email output rather than implying browser previews prove compatibility.
