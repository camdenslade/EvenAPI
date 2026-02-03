# Production Deployment Hardening Checklist

Use this checklist before deploying to production to ensure all security hardening measures are in place.

## Environment & Configuration

- [ ] All required environment variables are set (no dev fallbacks)
- [ ] `NODE_ENV=production` is set
- [ ] `PHONE_HASH_SALT` is set and secure
- [ ] `FIREBASE_SERVICE_ACCOUNT` is set
- [ ] `AWS_S3_BUCKET` is set
- [ ] `POSTGRES_HOST` is set
- [ ] `REDIS_HOST` is set
- [ ] `PUBLIC_API_BASE_URL` is set and matches production domain

## S3 Media Safety

- [ ] HTTPS-only presigned URLs are enforced
- [ ] MIME type allow-list is configured (image/jpeg, image/png, image/webp)
- [ ] Maximum file size limit is set (10 MB)
- [ ] Content type validation occurs before signing
- [ ] Debug console.log statements removed from S3 service

## Global Exception Handling

- [ ] Global HTTP exception filter is applied
- [ ] Error responses are JSON formatted
- [ ] Stack traces are removed in production
- [ ] PII is stripped from error messages
- [ ] No environment details exposed in errors

## Log Sanitization

- [ ] Log sanitizer utility is in use
- [ ] Phone numbers are redacted in logs
- [ ] Phone hashes are redacted in logs
- [ ] Firebase tokens are redacted in logs
- [ ] AWS credentials are redacted in logs
- [ ] Email addresses are partially redacted (domain visible)
- [ ] Structured logging (NestJS Logger) is used instead of console.log
- [ ] Error stacks are dropped in production logs
- [ ] **NOTE**: Using NestJS built-in logger (acceptable for initial production)
- [ ] **TODO**: For production scale, consider Pino/Winston with JSON logs and log aggregation (CloudWatch, Datadog)

## Security Headers

- [ ] CORS is configured with strict origin matching
- [ ] X-Powered-By header is disabled
- [ ] Content-Type validation is enforced
- [ ] Security headers are set (if using Helmet)

## Rate Limiting

- [ ] Rate limiting middleware is applied globally
- [ ] Auth endpoints: 5 requests per 15 minutes
- [ ] Report endpoints: 10 requests per hour
- [ ] Block endpoints: 20 requests per hour
- [ ] Default: 100 requests per 15 minutes
- [ ] **NOTE**: Current implementation uses in-memory store (per-instance)
- [ ] **TODO**: For multi-instance deployments, upgrade to Redis-backed rate limiting

## Static Code Checks

- [ ] ESLint security rules are configured
- [ ] No use of `eval`, `new Function`, or unsafe patterns
- [ ] No direct SQL string concatenation
- [ ] Parameterized queries are enforced via TypeORM
- [ ] Unhandled promises are detected

## Dependency Safety

- [ ] `npm audit` is run and passes
- [ ] No high or critical vulnerabilities
- [ ] Security audit script is in CI/CD pipeline
- [ ] Dependencies are up to date

## Frontend Security

- [ ] Content Security Policy (CSP) is configured
- [ ] No `unsafe-inline` scripts allowed
- [ ] Only trusted script sources are permitted
- [ ] `NODE_ENV=production` for release builds
- [ ] Source maps are disabled in production (optional)
- [ ] No use of `dangerouslySetInnerHTML`
- [ ] User input is sanitized before rendering

## React Server Components (RSC) Security

- [ ] Application does not use React Server Components (React Native/Expo)
- [ ] If RSC is added in future, untrusted input is never passed directly
- [ ] All props are sanitized before passing to server components
- [ ] URLs and file paths are validated before server-side operations

## Testing

- [ ] Security audit script passes: `npm run security:audit:ci`
- [ ] Rate limiting is tested on sensitive endpoints
- [ ] S3 upload validation is tested (MIME type, size)
- [ ] Error responses are tested (no stack traces in production)
- [ ] Log sanitization is verified

## Documentation

- [ ] `SECURITY.md` is up to date
- [ ] React RSC vulnerability is documented
- [ ] Security contact information is available
- [ ] Deployment checklist is reviewed

## Final Verification

- [ ] All items above are checked
- [ ] Code review completed
- [ ] Security review completed
- [ ] Production environment is configured
- [ ] Monitoring and alerting are in place

---

**Last Updated**: Stage 6 Implementation  
**Next Review**: Before each production deployment

