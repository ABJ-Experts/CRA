# terraform

Placeholder for the Terraform configuration that will manage cloud
infrastructure. Nothing here yet.

## When adding Terraform here

Commit `.terraform.lock.hcl` — it pins provider checksums and is what makes
`terraform init` reproducible across machines and CI.

Never commit:

- `.terraform/` — the local provider/module cache
- `*.tfstate` / `*.tfstate.backup` — state files routinely contain plaintext
  secrets (database passwords, generated keys) even when the resource itself
  is marked sensitive
- `*.tfvars` — variable files, typically holding credentials. Commit a
  `*.tfvars.example` with placeholder values instead

The root `.gitignore` already enforces all of the above.

Prefer a remote backend (S3 + DynamoDB lock, or Terraform Cloud) over local
state before more than one person runs `apply`.
