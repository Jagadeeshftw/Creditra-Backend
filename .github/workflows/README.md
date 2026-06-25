# Backend CI Workflow Documentation

## Overview

The `backend-ci.yml` workflow provides comprehensive continuous integration for the Creditra backend, running on every pull request and push to main/develop branches.

## Workflow Features

### 1. Multi-Node Version Testing
- Tests against supported Node.js LTS versions: 20.x, 22.x
- Ensures compatibility across different Node environments
- Fail-fast disabled to see results from all versions

### 2. Core CI Steps
- **Dependency Installation**: Uses `npm ci` for clean, reproducible installs
- **Linting**: Runs ESLint to enforce code quality standards
- **Type Checking**: Validates TypeScript types with `tsc --noEmit`
- **Build**: Compiles TypeScript to ensure no build errors
- **Testing**: Runs full test suite with `npm test`

### 3. Coverage Reporting
- Generates coverage report on Node 20.x (primary LTS)
- Uploads coverage artifacts for review
- Validates 95% coverage threshold requirement
- Retains reports for 7 days

### 4. Additional Validations
- **OpenAPI Spec Validation**: Ensures API documentation is valid YAML
- **Security Audit**: Runs `npm audit` to check for vulnerable dependencies
- **Secret Detection**: Scans for hardcoded API keys, private keys, or secrets

### 5. Security Checks
The workflow includes checks for:
- Hardcoded Stellar private keys
- API keys not using environment variables
- PII exposure in code
- Vulnerable npm packages

## Testing Locally

Before pushing, run these commands locally:

```bash
# Install dependencies
npm ci

# Run linter
npm run lint

# Type check
npm run typecheck

# Build
npm run build

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Validate OpenAPI spec
npm run validate:spec
```

## Coverage Requirements

- Minimum 95% coverage on touched modules
- Coverage report available in `coverage/` directory
- View HTML report: `coverage/lcov-report/index.html`

## Workflow Triggers

- **Pull Requests**: Runs on PRs targeting `main` or `develop`
- **Push**: Runs on direct pushes to `main` or `develop`
- **Concurrency**: Cancels in-progress runs for the same ref

## Artifacts

- Coverage reports uploaded as artifacts
- Available for 7 days after workflow run
- Download from GitHub Actions UI

## Security Notes

### Environment Variables Required
None required for basic CI. For integration tests with Stellar:
- `STELLAR_NETWORK` (testnet/mainnet)
- `HORIZON_URL`
- API keys should use GitHub Secrets

### Sensitive Data Guidelines
- Never commit private keys or API keys
- Use `process.env` for all secrets
- Stellar keys should be generated per environment
- PII must not be in test fixtures

## Troubleshooting

### Lint Failures
```bash
npm run lint:fix  # Auto-fix issues
```

### Type Errors
```bash
npm run typecheck  # See all type errors
```

### Test Failures
```bash
npm run test:watch  # Run tests in watch mode
```

### Coverage Below 95%
Add tests for uncovered code paths or update vitest configuration.

## Commit Message Format

Follow conventional commits:
```
ci(backend): add comprehensive test and lint workflow

- Multi-node version matrix (20.x, 22.x)
- Coverage reporting with 95% threshold
- Security audit and secret detection
- OpenAPI spec validation
```

## Timeframe

- Expected completion: 96 hours from PR creation
- Workflow runs typically complete in 5-10 minutes
- Coverage reports available immediately after run

## Related Documentation

- [OpenAPI Spec](../../docs/openapi.yaml)
- [Security Checklist](../../docs/security-checklist-backend.md)
- [Repository Architecture](../../docs/REPOSITORY_ARCHITECTURE.md)
