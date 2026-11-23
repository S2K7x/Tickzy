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
    /**
     * Which proxies may set X-Forwarded-For (client IP drives rate limits). "false" (default) = use the socket
     * address; a number = trust that many hops; otherwise a comma-separated list of proxy addresses/CIDRs.
     */
    TRUST_PROXY: z.string().default("false"),
    RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(600),
    RATE_LIMIT_IP_PER_MIN: z.coerce.number().int().min(1).default(1200),
    RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().min(1).default(20),
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

/** Fastify `trustProxy` value from TRUST_PROXY. Never `true` (that would let any client pick its IP). */
export function trustProxySetting(value: string): false | string[] | ((address: string, hop: number) => boolean) {
  const v = value.trim();
  if (v === "" || v === "false") return false;
  if (/^\d+$/.test(v)) {
    const hops = Number(v);
    return (_address, hop) => hop < hops; // trust exactly `hops` proxies in front of us
  }
  if (v === "true") throw new Error("TRUST_PROXY=true would trust spoofed X-Forwarded-For; set a hop count or proxy addresses");
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  trustProxySetting(parsed.data.TRUST_PROXY); // fail fast on an unsafe value
  return parsed.data;
}
