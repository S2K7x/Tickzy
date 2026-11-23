import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Workspace, errorMessage } from "../lib/api.ts";
import { rememberWorkspace, SESSION_KEY } from "../lib/session.ts";
import { AuthLayout, inputClass, primaryButtonClass } from "./AuthLayout.tsx";

export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
export function prefixFrom(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const p = words.length > 1 ? words.map((w) => w[0]).join("") : words[0]!;
  return p.slice(0, 4).padEnd(2, "X");
}

/** UX spec S11 step 1: create the first workspace (FR-1.1). */
export function Onboarding() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [prefix, setPrefix] = useState("");
  const [touched, setTouched] = useState({ slug: false, prefix: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const effSlug = touched.slug ? slug : slugify(name);
  const effPrefix = touched.prefix ? prefix : prefixFrom(name);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setBusy(true);
    try {
      const ws = await api<Workspace>("/v1/workspaces", { method: "POST", body: { name: name.trim(), slug: effSlug, issue_prefix: effPrefix } });
      rememberWorkspace(ws.id);
      await qc.invalidateQueries({ queryKey: SESSION_KEY });
      await navigate({ to: "/" });
    } catch (err) {
      if (err instanceof ApiError && err.code === "conflict") setErrors({ slug: "This URL is already taken." });
      else if (err instanceof ApiError && err.details.length) {
        setErrors(Object.fromEntries(err.details.map((d) => [d.path.replace(/^body\./, ""), d.issue])));
      } else setErrors({ form: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  const field = (id: string) => (errors[id] ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {});
  const errorText = (id: string) =>
    errors[id] ? (
      <span id={`${id}-error`} className="text-[13px] font-normal text-danger">
        {errors[id]}
      </span>
    ) : null;

  return (
    <AuthLayout title="Create your workspace" subtitle="A workspace holds your team's inbox, customers and settings.">
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Company or team name
          <input className={inputClass} name="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} {...field("name")} />
          {errorText("name")}
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Workspace URL
          <span className="flex items-center gap-1 text-[13px] font-normal text-muted">
            tickzy.app/
            <input
              className={inputClass}
              name="slug"
              value={effSlug}
              onChange={(e) => { setTouched((t) => ({ ...t, slug: true })); setSlug(e.target.value.toLowerCase()); }}
              {...field("slug")}
            />
          </span>
          {errorText("slug")}
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Issue prefix
          <input
            className={`${inputClass} uppercase`}
            name="issue_prefix"
            value={effPrefix}
            maxLength={5}
            onChange={(e) => { setTouched((t) => ({ ...t, prefix: true })); setPrefix(e.target.value.toUpperCase()); }}
            {...field("issue_prefix")}
          />
          <span className="text-[13px] font-normal text-muted">Issues will be numbered {effPrefix || "ABC"}-1, {effPrefix || "ABC"}-2…</span>
          {errorText("issue_prefix")}
        </label>
        {errors.form && <p role="alert" className="m-0 text-sm text-danger">{errors.form}</p>}
        <button type="submit" className={primaryButtonClass} disabled={busy || name.trim() === ""}>
          {busy ? "Creating…" : "Create workspace"}
        </button>
      </form>
    </AuthLayout>
  );
}
