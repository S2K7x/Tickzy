import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api.ts";
import { AuthLayout, inputClass, primaryButtonClass } from "./AuthLayout.tsx";

/** FR-1.2: passwordless sign-in. The API answers the same way for unknown emails, so does this page. */
export function SignIn() {
  const [email, setEmail] = useState("");
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
    </AuthLayout>
  );
}
