# Incident Checklist

- Confirm the affected routes, users, and approximate start time.
- Preserve sanitized application and reverse-proxy logs before restarting.
- Check `/healthz` and `/api/system/health` through the public proxy.
- Check Compose service state and PostgreSQL health.
- Review recent migrations and recent image or configuration changes.
- Check secret expiration, rotation history, and origin configuration.
- Check host and PostgreSQL storage capacity.
- Avoid destructive commands, volume removal, and schema changes during investigation.
- Record each recovery action and its timestamp.
- After recovery, verify authentication, role boundaries, no-store behavior, and privacy boundaries.
- Confirm that only the reverse proxy is host-exposed.
- Escalate for database restore or secret rotation decisions when required.

Do not claim that automated backups, monitoring, or cloud failover exist unless
they have been configured and verified separately.
