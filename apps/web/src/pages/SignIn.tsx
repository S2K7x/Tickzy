import { useState, type FormEvent } from "react";
import { useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api.ts";
import { pendingInviteToken } from "../lib/invite.ts";
import { AuthLayout, inputClass, primaryButtonClass } from "./AuthLayout.tsx";

type Provider = "google" | "microsoft";
const PROVIDER_LABEL: Record<Provider, string> = { google: "Google", microsoft: "Microsoft" };
/** Messages for `?error=` set by the server after a Google/Microsoft attempt (ADR-024). */
const PROVIDER_ERRORS: Record<string, string> = {
  email_unverified: "That account's email address isn't verified by the provider, so we can't use it to sign you in. Use an email link instead.",
  cancelled: "Sign-in was cancelled.",
  provider_disabled: "That sign-in method isn't available.",
  provider_unavailable: "We couldn't reach the sign-in provider. Try again, or use an email link.",
  oauth_failed: "Sign-in didn't complete. Please try again.",
};

/** FR-1.2: passwordless sign-in. The API answers the same way for unknown emails, so does this page. */
export function SignIn() {
  const search = useSearch({ strict: false }) as { email?: string; error?: string };
  const [email, setEmail] = useState(search.email ?? "");
  const providers = useQuery({
    queryKey: ["auth-providers"],
    queryFn: () => api<{ providers: Provider[] }>("/v1/auth/providers"),
    staleTime: Infinity,
    retry: false,
  });
  const providerError = search.error ? (PROVIDER_ERRORS[search.error] ?? PROVIDER_ERRORS.oauth_failed) : null;
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setState("sending");
    try {
      await api("/v1/auth/magic-link", { method: "POST", body: { email } });
      setState("sent");
    } catch (err) {
      setState("idle");
      setError(err instanceof ApiError && err.code === "validation_failed" ? "Enter a valid email address." : (err as Error).message);
    }
  }

  if (state === "sent") {
    return (
      <AuthLayout title="Check your email" subtitle={`We sent a sign-in link to ${email}. It expires in 15 minutes.`}>
        <button type="button" className="text-left text-sm font-semibold text-accent-fg" onClick={() => setState("idle")}>
          Use a different email
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Sign in to Tickzy" subtitle="We'll email you a link — no password needed.">
      {providerError && <p role="alert" className="m-0 text-sm text-danger">{providerError}</p>}
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Work email
          <input
            className={inputClass}
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "signin-error" : undefined}
          />
        </label>
        {error && (
          <p id="signin-error" role="alert" className="m-0 text-sm text-danger">
            {error}
          </p>
        )}
        <button type="submit" className={primaryButtonClass} disabled={state === "sending" || email.trim() === ""}>
          {state === "sending" ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>
      {!!providers.data?.providers.length && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 text-xs text-muted" aria-hidden="true">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
          {providers.data.providers.map((p) => (
            <a
              key={p}
              href={`/v1/auth/oauth/${p}/start?return_to=${encodeURIComponent(pendingInviteToken() ? "/invite" : "/")}`}
              className="inline-flex h-11 w-full items-center justify-center rounded-[10px] border border-line bg-surface px-4 text-sm font-semibold text-fg no-underline hover:bg-surface-2"
            >
              Continue with {PROVIDER_LABEL[p]}
            </a>
          ))}
        </div>
      )}
    </AuthLayout>
  );
}
