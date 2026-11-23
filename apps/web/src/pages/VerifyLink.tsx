import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.ts";
import { SESSION_KEY } from "../lib/session.ts";
import { AuthLayout } from "./AuthLayout.tsx";

// One verification per page load. The page can remount while the session refetches (and under StrictMode);
// later mounts attach to the in-flight request instead of POSTing again — the token is single-use and has
// already been removed from the URL by then.
let verification: Promise<unknown> | null = null;

function verifyOnce(): Promise<unknown> {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  if (token) {
    history.replaceState(null, "", window.location.pathname); // drop the token from the address bar/history
    verification = api("/v1/auth/magic-link/verify", { method: "POST", body: { token } });
  }
  return verification ?? Promise.reject(new Error("This sign-in link is incomplete. Request a new one."));
}

/**
 * Landing page of the emailed link. The token travels in the URL fragment (never sent to servers or in
 * Referer headers); we POST it so link-scanning mail filters cannot consume it with a GET (ADR-021).
 */
export function VerifyLink() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    verifyOnce()
      .then(async () => {
        if (!active) return;
        await qc.invalidateQueries({ queryKey: SESSION_KEY });
        await navigate({ to: "/" });
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [navigate, qc]);

  if (error) {
    return (
      <AuthLayout title="This link didn't work" subtitle={error}>
        <Link to="/sign-in" className="text-sm font-semibold text-accent-fg no-underline">
          Request a new sign-in link
        </Link>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Signing you in…">
      <p role="status" className="m-0 text-sm text-muted">
        One moment.
      </p>
    </AuthLayout>
  );
}
