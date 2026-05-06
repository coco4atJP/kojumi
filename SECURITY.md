# Security Policy

Kojumi Beta1 uses API keys and evaluation signing secrets. Treat both as
confidential.

## Do Not Commit

- production API keys
- `MASTER_API_KEY`
- `API_KEYS_FILE` contents
- evaluation signing secrets
- uploaded delivery artifacts
- production databases
- logs containing participant data
- private benchmark answer keys or hidden rubrics

## Reporting Security Issues

Please report suspected vulnerabilities privately by opening a minimal GitHub
issue that asks for a secure contact channel, or by contacting the project
maintainer through the public profile listed on the repository.

Do not publish exploit details, leaked keys, private participant data, or
delivery artifacts in public issues.

## Public API Expectations

The public API should expose only curated public reads. Contracts, executions,
deliveries, evaluation records, delivery files, and direct-hire streams must
require authentication.
