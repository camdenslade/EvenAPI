# Security Policy

## Repository Scope

This repository contains the **backend services and infrastructure code** for the Even Dating application.

Due to the sensitive nature of this codebase (authentication, user data, moderation, and messaging), **this repository is private** and access is restricted.

---

## Supported Versions

Only the **latest `main` branch** is actively supported with security updates.

| Version | Supported |
|--------|-----------|
| `main` | Yes |

---

## Reporting Security Issues

### Internal Reporting Only

Security issues for this repository **must be reported privately**.

Do **not** open issues or pull requests describing vulnerabilities.

### Reporting Methods

- Email: **security@evendating.com**
- Or contact the repository owner directly via secure channel

When reporting, include:
- Detailed description of the issue
- Affected files, endpoints, or services
- Steps to reproduce (if applicable)
- Potential impact (data exposure, privilege escalation, abuse, etc.)

---

## Disclosure & Handling

- All reports will be triaged as soon as possible
- Confirmed vulnerabilities will be patched promptly
- Access logs and audit trails may be reviewed as part of investigation
- Public disclosure is **not permitted** without explicit approval

---

## In Scope

This policy covers:
- API endpoints and authorization logic
- Authentication and session handling
- Database access and migrations
- Messaging, reviews, and moderation systems
- Admin and privileged routes
- Background jobs and cron tasks
- Token, entitlement, and abuse prevention logic

---

## Out of Scope

- Frontend code (see frontend repository)
- Third-party services and providers (Firebase, AWS, Redis, etc.)
- Infrastructure managed outside this repository
- Denial-of-service attacks at the network layer

---

## Security Practices

The backend follows these security principles:

- Authentication via Firebase Admin SDK
- Role-based access control and route guards
- Input validation using class-validator
- Rate limiting on sensitive endpoints
- Secure secret management via environment variables
- HTTPS enforced for all client communication
- No credentials committed to source control

---

## Access Control

- Repository access is limited to trusted contributors
- Production secrets are not shared outside secure environments
- Admin capabilities are restricted and audited

---

## No Bug Bounty

There is currently **no public bug bounty program** for the backend.

Responsible internal disclosure is expected and appreciated.

---

## Compliance & Responsibility

All contributors are expected to:
- Follow secure coding practices
- Avoid introducing breaking or insecure changes
- Review security implications of migrations and schema changes
- Protect user privacy and safety at all times

---

## Contact

For security-related concerns:
**support@evendating.us**
