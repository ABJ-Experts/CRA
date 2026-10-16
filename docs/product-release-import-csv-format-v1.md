# Product and release CSV import format V1

**Schema version:** `m2-product-release-import-v1`  
**Template:** [`examples/product-release-import-v1.csv`](examples/product-release-import-v1.csv)

This format is a strict, mixed-record CSV for the M2 product registry. A file
does not mutate products or releases: it always creates a dry run first. A
successful dry run is valid for 24 hours and commit requires the identical
server-verified content hash.

## Transport rules

- Encode as UTF-8, optionally beginning with a UTF-8 BOM. Use comma delimiters;
  semicolon/tab delimiters and compressed archives are not supported.
- RFC-4180 quoted cells, escaped double quotes, CRLF or LF endings, embedded
  commas/newlines, empty cells, and trailing blank lines are supported.
- Maximum source size is 10 MiB; maximum physical data records (including blank
  records) is 10,000; maximum cell size is 16 KiB. Blank records are classified
  as skipped only after this cap is enforced, so a file with millions of blank
  lines fails safely. Header-only and all-blank files are invalid.
- Header names are ASCII lower snake case. The complete header row below is
  required; unknown, duplicate, or NFKC/case-fold-ambiguous headers reject the
  entire dry run. Column order is fixed in V1 to eliminate ambiguous mappings.
- Values are strings. Do not rely on locale-sensitive parsing. V1 has no date,
  timestamp, number, archive, lifecycle, or support-period fields.

## Header and record rules

```text
format_version,record_type,operation,product_internal_code,product_name,product_type,product_description,owner_email,legal_entity_identifier,release_version,release_label,release_description,expected_version
```

| Column | Product create/update | Release create/update | Rule |
| --- | --- | --- | --- |
| `format_version` | required | required | Exactly `m2-product-release-import-v1` on every nonblank row. |
| `record_type` | required | required | `product` or `release`. |
| `operation` | required | required | `create` or `update`; dry run derives `unchanged`, `skipped`, and `failed`. |
| `product_internal_code` | required | required | Product identity. Its normalized form is tenant-unique. No UUIDs. |
| `product_name` | required | required for update when changing name | Required for product create; blank means unchanged only for update. |
| `product_type` | required | required for update when changing type | Product enum; blank means unchanged only for update. |
| `product_description` | optional | optional | Product-only; blank is an explicit empty description only when update marks it as supplied. |
| `owner_email` | required | optional | Product-only; resolves to an active member within the active organization. |
| `legal_entity_identifier` | required on create | not allowed | Product-only; resolves only within the active organization and cannot be changed by V1 update. |
| `release_version` | not allowed | required | Release identity within `product_internal_code`. |
| `release_label` | not allowed | required on create | Opaque display label; blank means unchanged only for update. |
| `release_description` | not allowed | optional | Release-only. |
| `expected_version` | required on update | required on update | Positive aggregate version from a prior read; forbidden for create. |

Product and release rows may be interleaved. A release may appear before a
product-create row for the same internal code; dry run validates the complete
file and commit executes valid product rows before release rows. Each identity
may occur only once per file. Repeated/conflicting identities, duplicate create
commands, and an update that does not match the current tenant-local snapshot
are errors.

`update` is non-destructive. It can change only fields already permitted by the
interactive update use case. It cannot archive/delete, alter lifecycle/support
periods, transfer legal entity, rename an identity, or create an implicit
owner/legal entity. For an update whose supplied values equal the snapshot,
dry run reports `unchanged`.

## Owner and identity resolution

`owner_email` is trimmed and normalized for lookup only inside the
verified active organization. A missing, inactive, or foreign email reports
the same safe field error; it does not reveal whether another tenant owns that
email. `legal_entity_identifier` follows the existing legal-entity identifier
contract and likewise resolves only in the active organization.

The active organization is taken from the verified session, never from a CSV
column. A user changing organization must start a new dry run in the selected
organization.

## Example

```csv
format_version,record_type,operation,product_internal_code,product_name,product_type,product_description,owner_email,legal_entity_identifier,release_version,release_label,release_description,expected_version
m2-product-release-import-v1,product,create,GW-100,Sentinel Gateway,hardware_with_software,Gateway product,owner@example.test,abj-eu,,,,
m2-product-release-import-v1,release,create,GW-100,,,,,,1.0.0,Initial release,First commercial release,
```

## Result report and upgrade guidance

The result export uses `text/csv; charset=utf-8`. It includes source row number,
row type, requested/proposed action, final result, safe canonical product/release
IDs, field, issue code, and user-facing message. It never includes source CSV
cells, foreign-tenant data, evidence, or owner details. Every report cell is
RFC-4180 quoted, and cells whose first non-whitespace character is `=`, `+`,
`-`, or `@` are apostrophe-prefixed to neutralize spreadsheet formulas.

V1 accepts only the exact version above. Future formats will use a new
`format_version`, a separately published complete header, and an explicit
migration guide; old files remain interpretable as their recorded dry-run
schema version and are never silently remapped.
