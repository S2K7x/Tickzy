import { z } from "zod";

const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().default("0.0.0.0"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    DATABASE_URL: z.string().url(),
    AUTH_DEV_MODE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    /** Web app origin: used in sign-in links and as the CSRF Origin allow-list (comma-separate extra origins in ALLOWED_ORIGINS). */
    APP_ORIGIN: z.url().default("http://localhost:5173"),
    ALLOWED_ORIGINS: z.string().default(""),
    COOKIE_SECURE: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    EMAIL_TRANSPORT: z.enum(["console"]).default("console"),
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV === "production" && c.AUTH_DEV_MODE) {
      ctx.addIssue({ code: "custom", path: ["AUTH_DEV_MODE"], message: "AUTH_DEV_MODE must never be enabled in production" });
    }
    if (c.NODE_ENV === "production" && c.EMAIL_TRANSPORT === "console") {
      ctx.addIssue({ code: "custom", path: ["EMAIL_TRANSPORT"], message: "console email transport is for development only (Postmark arrives with T-303)" });
    }
    if (c.NODE_ENV === "production" && !c.COOKIE_SECURE) {
      ctx.addIssue({ code: "custom", path: ["COOKIE_SECURE"], message: "cookies must be Secure in production" });
    }
  });

export type Config = z.infer<typeof ConfigSchema>;

export function allowedOrigins(c: Pick<Config, "APP_ORIGIN" | "ALLOWED_ORIGINS">): string[] {
  const extra = c.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
  return [...new Set([new URL(c.APP_ORIGIN).origin, ...extra.map((o) => new URL(o).origin)])];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}
