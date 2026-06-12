# Contributing to Creditra Backend

Thank you for your interest in contributing to the **Creditra Backend**!  
We focus on delivering a **secure, tested, documented, and performant API and services** for credit lines, risk evaluation, and future features.2

Before submitting a contribution, please read this guide carefully.

---

##  Getting Started

### 1. Fork & Branch

1. Fork the repository on GitHub.

2. Clone your fork:

   ```bash
   git clone https://github.com/<your-username>/Creditra-Backend.git
   cd Creditra-Backend
```
3. Create a branch for your work:
```bash
git checkout -b docs/backend-contributing
```
4. Make your changes and commit.

## Local Setup

- Prerequisites

- Node.js 18+

- npm (or Yarn)

- PostgreSQL (local or remote)

> Optional: Redis and Horizon if running advanced services

## Install Dependencies
```bash
npm install
```

## Environment Variables
Copy the example and set any required credentials:

```bash
cp .env.example .env
```
Required:
```bash
PORT=3000
DATABASE_URL="postgresql://user:pass@localhost:5432/creditra"
```
> Security: Never commit secrets or real credentials. Use a .env.local file or secret manager for sensitive data.

Run the App

- Development + watch:
```bash
npm run dev
```
- Build & Run:
```bash
npm run build
npm start
```

## Available Scripts
Script                    Description
`npm run dev`             Run server in watch mode
`npm test`                Run tests
`npm run coverage`        Generate test coverage report
`npm run db:migrate`      Apply database migrations
`npm run db:validate`     Validate migration state

# Testing
We use Vitest for unit and integration tests. All new features or changes must include tests.

## Guidelines

- Aim for ≥ 95% test coverage on any new code.

- Tests should be deterministic and not depend on external services.

- Mock external calls where possible.

- Tests should run locally without special setup.

## Run Tests
```bash
npm test
```
- Coverage report:
```bash
npm run coverage
```

# Code Standards
- TypeScript with strict mode

- Follow existing project structure under src/

- Use ESM imports

- API routes should live under src/routes/

- Helpers and utilities under src/utils/

Formatting & Linting

- We recommend consistent formatting:

- Prettier for formatting

- ESLint for linting (if configured)

Before committing, format code:
```bash
npm run lint
```

# Security
Security is a priority.

- Do NOT log secrets, private keys, or wallet private data.

- Validate user inputs at the edge (request layer).

- Always sanitize and escape external input.

- Never commit API keys, private credentials, or production URLs.

- Use safe comparison and hashing for sensitive values.

- Review open security issues before adding features.

Wallet data handling:

- Always treat wallet addresses and signatures as sensitive.

- Avoid logging or exposing wallet‐linked secrets.

- Ensure services that interact with funds follow strict access rules.

## Performance
- Prefer indexed database queries for frequent lookups.

- Avoid N+1 queries.

- Cache read-heavy operations using Redis where appropriate.

- Profile APIs with real data before merging (benchmark and log).

## Code Reviews
To speed review and maintain quality:
- Use concise commit messages (see below)

- Link related issues

- Include test output, coverage results, and screenshots if UI involved

- Always rebase on main before opening a PR

- Describe intent and edge cases in PR description

# Commit & Branch Conventions
Branch Naming
Use descriptive branch names:
```bash
feature/<feature-name>
fix/<short-description>
docs/<documentation-area>
```

Commit Messages
Use clear messages:

- feat: for new features

- fix: for bug fixes

- docs: for documentation

- test: for adding/updating tests

- perf: for performance improvements

# Performance & Maintenance Expectations

- New endpoints should include performance benchmarks.

- Regressions in performance must be justified in PR.

- Periodically update dependencies, especially security patches.


Thank you!
We appreciate your efforts and contributions to making the Creditra Backend secure, tested, and well-documented. If you have any questions, drop a comment on the related issue.
Happy coding! 
