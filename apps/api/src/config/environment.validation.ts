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
});
