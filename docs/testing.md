# Craftly v1.1.0 — Comprehensive Production Test Harness

The production test harness makes `test/test.sh` the release-oriented test entry point.

## Run

```bash
bash test/test.sh
```

Equivalent:

```bash
bash test/production-test.sh
```

## Test result semantics

- **PASS** — the check actually executed and passed.
- **FAIL** — the check executed and found a defect. This blocks certification.
- **SKIP** — the required external environment/configuration was unavailable. A SKIP is not a PASS and must be reviewed before production deployment.

## Optional live checks

For an already-running panel:

```bash
CRAFTLY_TEST_BASE_URL=http://127.0.0.1:6060 \
QA_USER=admin \
QA_PASS='your-password' \
bash test/test.sh
```

For Docker integration:

```bash
CRAFTLY_TEST_DOCKER=1 bash test/test.sh
```

Use a real Node 24+ environment with dependencies installed for the build, lint, typecheck, and full automated test suite:

```bash
pnpm install
bash test/test.sh
```

For production certification, configure the actual deployment environment and review all SKIP entries. Cloudflare, remote nodes, SFTP, databases, Docker provisioning, backups, and other infrastructure-dependent functions require the corresponding real services/credentials to be available.

The harness intentionally does not create fake credentials, fake servers, or fake external services and does not report unavailable integrations as PASS.

## What the production test harness covers

The harness is intentionally layered. It checks static release integrity first, then uses the real application toolchain when available, then tests Docker/deployment behavior, then optionally performs authenticated live HTTP QA. It also executes the existing Node test suite when Node 24+ and dependencies are present.

It does not claim external services are working when they are unavailable. A production deployment should therefore be certified only after the SKIP entries for that deployment are resolved and the resulting run has zero FAIL entries.
