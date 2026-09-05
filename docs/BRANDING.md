# Open-Box brand boundary

Open-Box is HillStreet's branded multi-cloud storage distribution at
`https://open-box.space`. OpenList is the upstream engine and remains credited
where attribution, source compatibility, driver identity, or upgrade tooling
requires its name.

## Public identity

- Product name: **Open-Box**
- Domain: `open-box.space`
- Repository: `hillstreet-ph/open-box`
- Primary color: `#7c3aed`
- Logo and favicon: `/open-box-brand.svg`
- Public CLI description, MCP titles, FTP banner, torrent metadata, integration
  pages, Docker metadata, and default site settings use Open-Box.

## Compatibility identifiers

The following intentionally retain `openlist` and must not be bulk-renamed:

- Go module/import path `github.com/OpenListTeam/OpenList/v4`
- runtime binary `openlist`
- persistent path `/opt/openlist/data`
- database tables prefixed `x_`
- upstream remote, driver names, upstream build actions, and upstream docs links

Changing these identifiers would break upstream merges, compiled imports,
existing volumes, deployments, or driver compatibility. They are implementation
details, not the customer-facing product identity.

## Account integrations

The public integration manifest is credential-free and supports multiple unique
account mounts for Google Workspace/Drive, Dropbox, OneDrive, Box, TeraBox, and
MEGA. OAuth tokens and provider secrets are stored only in authenticated
backend/runtime configuration.

The integration registry permits multiple rows per provider using the unique
key `(user_id, provider, account_key)`. Google API capabilities such as Gmail
are recorded separately from filesystem collection, even when they use the
same Google identity.
