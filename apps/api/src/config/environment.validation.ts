import * as Joi from "joi";

const postgresqlUrl = Joi.string()
  .trim()
  .custom((value: string, helpers) => {
    try {
      const url = new URL(value);

      if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
        return helpers.error("string.uriCustomScheme", {
          scheme: ["postgresql", "postgres"],
        });
      }

      return value;
    } catch {
      return helpers.error("string.uri");
    }
  }, "PostgreSQL URL validation")
  .required()
  .messages({
    "any.required": "DATABASE_URL is required",
    "string.empty": "DATABASE_URL is required",
    "string.uri": "DATABASE_URL must be a valid PostgreSQL URL",
    "string.uriCustomScheme": "DATABASE_URL must use postgresql or postgres scheme",
  });

export const environmentValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "test", "production")
    .default("development"),
  HOST: Joi.string().trim().min(1).default("127.0.0.1"),
  PORT: Joi.number().port().default(3001),
  DATABASE_URL: postgresqlUrl,
  DATABASE_POOL_MAX: Joi.number().integer().min(1).max(100).default(10),
  DATABASE_CONNECTION_TIMEOUT_MS: Joi.number()
    .integer()
    .min(100)
    .max(60000)
    .default(5000),
  DATABASE_IDLE_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(600000)
    .default(30000),
  JWT_ACCESS_SECRET: Joi.string()
    .min(32)
    .invalid("replace-with-at-least-32-random-characters")
    .required()
    .messages({
      "any.invalid": "JWT_ACCESS_SECRET must be replaced",
      "any.required": "JWT_ACCESS_SECRET is required",
      "string.empty": "JWT_ACCESS_SECRET is required",
      "string.min": "JWT_ACCESS_SECRET must be at least 32 characters",
    }),
  JWT_ACCESS_TTL_SECONDS: Joi.number()
    .integer()
    .min(60)
    .max(86400)
    .default(900),
  JWT_ISSUER: Joi.string().trim().min(1).default("auction-api"),
  JWT_AUDIENCE: Joi.string().trim().min(1).default("auction-web"),
});
