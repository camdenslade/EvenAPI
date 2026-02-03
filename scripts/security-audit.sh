#!/bin/bash
# Security audit script for CI/CD pipeline
# Fails if high or critical vulnerabilities are found

set -e

echo "Running security audit..."

# Run npm audit
npm audit --production --json > audit-report.json || true

# Check for high or critical vulnerabilities
HIGH_CRITICAL=$(node -e "
  const audit = require('./audit-report.json');
  const vulns = audit.vulnerabilities || {};
  let count = 0;
  for (const vuln of Object.values(vulns)) {
    if (vuln.severity === 'high' || vuln.severity === 'critical') {
      count += (vuln.via || []).length;
    }
  }
  console.log(count);
")

if [ "$HIGH_CRITICAL" -gt 0 ]; then
  echo "ERROR: Found $HIGH_CRITICAL high or critical vulnerabilities"
  echo "Please review audit-report.json and update dependencies"
  exit 1
fi

echo "Security audit passed - no high or critical vulnerabilities found"

