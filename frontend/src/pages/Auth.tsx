import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { api, errorMessage } from "@/api/client";
import { Logo } from "@/components/layout/Logo";
import { Button, ErrorState, Field, Input, Notice } from "@/components/ui";
import { useAuth } from "@/lib/auth";

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-bg bg-lab-grid lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden border-r border-line lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_30%_30%,rgba(34,211,238,0.16),transparent),radial-gradient(50%_40%_at_70%_70%,rgba(167,139,250,0.16),transparent)]" />
        <div className="relative flex h-full flex-col justify-between p-10">
          <Logo to="/" />
          <div className="max-w-md">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">Sense → Understand → Decide → Act</p>
            <h2 className="mt-3 font-display text-4xl font-semibold leading-tight tracking-tight">
              The intelligence layer of a prosthetic hand — running live in your browser.
            </h2>
            <p className="mt-4 text-ink-2">
              Tactile readings flow through a trained random-forest classifier and a safety-aware grip engine, then drive a 3D prosthetic hand. Every number you see
              is computed — nothing is pre-recorded.
            </p>
          </div>
          <p className="text-xs text-muted">Academic research prototype · not a medical device</p>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo to="/" />
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token, setSession, notice, clearNotice } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const from = (location.state as { from?: string } | null)?.from ?? "/dashboard";
  const login = useMutation({
    mutationFn: () => api.login(email.trim(), password),
    onSuccess: (r) => {
      setSession(r.access_token, r.user);
      navigate(from, { replace: true });
    },
  });
  if (token) return <Navigate to={from} replace />;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    clearNotice();
    login.mutate();
  };
  return (
    <AuthLayout title="Sign in to the lab" subtitle="Access the virtual prosthetic lab, datasets and analytics.">
      {notice && <Notice tone="warn" className="mb-4">{notice}</Notice>}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {login.isError && <ErrorState title="Sign-in failed" error={new Error(errorMessage(login.error))} />}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={login.isPending} disabled={!email || !password}>
          Sign in <ArrowRight className="h-4 w-4" />
        </Button>
      </form>
      <Notice className="mt-6" icon={<KeyRound className="h-4 w-4" />}>
        <span className="font-medium text-ink">Examiner demo account</span> (seeded in development):<br />
        <span className="font-mono text-xs">demo@neurogrip.dev / demo-password-2026</span>
        <br />
        <button
          type="button"
          className="mt-1 text-xs font-medium text-accent underline-offset-2 hover:underline"
          onClick={() => {
            setEmail("demo@neurogrip.dev");
            setPassword("demo-password-2026");
          }}
        >
          Fill demo credentials
        </button>
      </Notice>
      <p className="mt-6 text-center text-sm text-muted">
        No account?{" "}
        <Link to="/register" className="font-medium text-accent hover:underline">
          Create one
        </Link>
      </p>
    </AuthLayout>
  );
}

export function Register() {
  const navigate = useNavigate();
  const { token, setSession } = useAuth();
  const [form, setForm] = useState({ full_name: "", email: "", password: "", confirm: "" });
  const [localError, setLocalError] = useState<string | null>(null);
  const pub = useQuery({ queryKey: ["public-settings"], queryFn: api.publicSettings, retry: 0 });
  const register = useMutation({
    mutationFn: () => api.register(form.email.trim(), form.password, form.full_name.trim()),
    onSuccess: (r) => {
      setSession(r.access_token, r.user);
      navigate("/dashboard", { replace: true });
    },
  });
  if (token) return <Navigate to="/dashboard" replace />;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (form.password.length < 8) return setLocalError("Password must be at least 8 characters.");
    if (form.password !== form.confirm) return setLocalError("Passwords do not match.");
    setLocalError(null);
    register.mutate();
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <AuthLayout title="Create a researcher account" subtitle="Accounts get the USER role. Administrators are provisioned separately.">
      {pub.data && !pub.data.allow_registration && <Notice tone="warn" className="mb-4">Registration is currently disabled by the administrator.</Notice>}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Full name" htmlFor="name">
          <Input id="name" autoComplete="name" value={form.full_name} onChange={set("full_name")} maxLength={120} />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Password" htmlFor="password" hint="8–72 characters. Stored as a bcrypt hash.">
          <Input id="password" type="password" autoComplete="new-password" required value={form.password} onChange={set("password")} />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={localError}>
          <Input id="confirm" type="password" autoComplete="new-password" required value={form.confirm} onChange={set("confirm")} />
        </Field>
        {register.isError && <ErrorState title="Registration failed" error={new Error(errorMessage(register.error))} />}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={register.isPending} disabled={!form.email || !form.password}>
          <ShieldCheck className="h-4 w-4" /> Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Already registered?{" "}
        <Link to="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
