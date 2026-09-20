# Open Box — Project Overview

## Platform role

**Data and artifact plane.**

Indexes and manages files, artifacts, project data, knowledge, backups, documents, media, datasets, and agent outputs across authorized storage sources.

## Responsibilities

- Multi-source inventory and indexing
- Read-and-copy master-library workflow
- Metadata, deduplication, verification, and search
- Project artifacts, backups, and knowledge storage
- Integration with Open Connect and Open System

## Ecosystem relationship

- [Open Connect](https://github.com/hillstreet-ph/open-connect) is the control plane.
- [Open System](https://github.com/hillstreet-ph/open-system) is the execution plane.
- [Open Box](https://github.com/hillstreet-ph/open-box) is the data and artifact plane.
- [Open Model](https://github.com/hillstreet-ph/open-model) provides model access and routing.
- Supporting services include Open TGate, Open Teleset, Open Hub, Open Payment, and Open KobePlay.

Each repository owns its implementation and versioned technical documentation. Cross-project changes should reference the affected repositories and preserve these responsibility boundaries.

## Security boundary

Originals remain in their authorized sources unless an approved copy workflow runs. Private source links, credentials, personal data, and restricted artifacts must not be committed.

Use placeholders in example configuration. Store runtime secrets in an approved secret manager, apply least-privilege access, redact sensitive logs, and require human approval for material permission, credential, finance, or production changes.

## Delivery expectations

A production-ready release should include:

- documented configuration and environment-variable contracts;
- automated tests and required CI checks;
- dependency and secret scanning;
- health checks, structured logs, and error monitoring;
- database migration and authorization review where applicable;
- backup, restore, rollback, and incident procedures;
- a reviewed deployment path for the selected runtime.

## Documentation map

Start with the repository README, then review the existing `docs/`, deployment guides, security policy, contribution guidance, and project-specific runbooks. Existing implementation documentation remains authoritative where it is more specific than this overview.

## Status note

This document describes the intended role and governance boundary. It does not by itself certify production readiness. Validate the current code, tests, deployment state, and open work before release.
