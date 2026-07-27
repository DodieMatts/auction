# Environment Variables

The production Compose stack reads `.env.production` through Compose
interpolation. Values are supplied to containers at runtime; secrets are not
Docker build arguments and are not baked into image layers.

| Name | Application | Required | Secret | Example shape | Purpose and validation |
| --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | API, web | Yes | No | `production` | Must be `production` for the deployment stack. |
| `POSTGRES_USER` | PostgreSQL | Yes | No | `auction_app` | Database owner username. |
| `POSTGRES_PASSWORD` | PostgreSQL | Yes | Yes | `replace-with-database-password` | Database password; replace the placeholder. |
| `POSTGRES_DB` | PostgreSQL | Yes | No | `auction` | Database name. |
| `DATABASE_URL` | API, migration | Yes | Yes | `postgresql://user:password@postgres:5432/auction?schema=public` | PostgreSQL URL validated by Prisma configuration and API startup. |
| `DATABASE_POOL_MAX` | API | No | No | `10` | PostgreSQL adapter pool size, 1 to 100. |
| `DATABASE_CONNECTION_TIMEOUT_MS` | API | No | No | `5000` | Connection timeout, validated by the API. |
| `DATABASE_IDLE_TIMEOUT_MS` | API | No | No | `30000` | Idle connection timeout, validated by the API. |
| `JWT_ACCESS_SECRET` | API | Yes | Yes | `replace-with-strong-random-value...` | At least 32 characters; never reuse a development secret. |
| `JWT_ACCESS_TTL_SECONDS` | API | No | No | `900` | Access-token lifetime, 60 to 86400 seconds. |
| `JWT_ISSUER` | API | No | No | `auction-api` | JWT issuer. |
| `JWT_AUDIENCE` | API | No | No | `auction-web` | JWT audience. |
| `HOST` | API | Yes | No | `0.0.0.0` | API bind address inside the container. |
| `PORT` | API | Yes | No | `3000` | API container port. |
| `API_BASE_URL` | web | Yes | No | `http://api:3000/api` | Server-only URL used by Next.js to reach NestJS. Never browser-public. |
| `ALLOWED_APP_ORIGIN` | API | Yes | No | `https://replace-with-application-host` | Deployment origin metadata; replace the placeholder. |

There are no browser-public backend URLs, JWT secrets, database URLs, or token
values. The frontend environment validator keeps `API_BASE_URL` server-only.
Use HTTPS for the public application origin in production.
