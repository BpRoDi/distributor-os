"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/ui";
import { roleLabels, type WorkspaceRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/client";

const roles: WorkspaceRole[] = [
  "brand_admin",
  "brand_finance",
  "brand_ops",
  "brand_sales",
  "distributor_buyer",
];

export default function LoginClient() {
  const router = useRouter();
  const [email, setEmail] = useState("founder@nimbus.example");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("brand_admin");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState<"signin" | "signup" | "demo" | null>(null);
  const nextPath = role === "distributor_buyer" ? "/portal" : "/app";

  function continueDemo() {
    setLoading("demo");
    window.localStorage.setItem("distributor-os-demo-session", JSON.stringify({
      role,
      email,
      createdAt: new Date().toISOString(),
    }));
    router.push(nextPath);
  }

  async function bootstrapRole() {
    const response = await fetch("/api/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, full_name: email.split("@")[0] || "Distributor OS user" }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Role bootstrap failed.");
    }
  }

  async function signIn() {
    setLoading("signin");
    setStatus("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await bootstrapRole();
      router.push(nextPath);
    } catch (error: any) {
      setStatus(error?.message || "Sign in failed.");
    } finally {
      setLoading(null);
    }
  }

  async function signUp() {
    setLoading("signup");
    setStatus("");
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { role } },
      });
      if (error) throw error;
      if (data.session) {
        await bootstrapRole();
        router.push(nextPath);
        return;
      }
      setStatus("Check your email to confirm this account, then sign in.");
    } catch (error: any) {
      setStatus(error?.message || "Account creation failed.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
      <div className="grid max-w-6xl gap-8 lg:grid-cols-[1fr_480px] lg:items-center">
        <div>
          <p className="mb-6 inline-flex rounded-[8px] bg-white/10 px-4 py-3 text-sm font-bold">Distributor OS</p>
          <h1 className="max-w-2xl text-4xl font-bold md:text-6xl">Brand and distributor access.</h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
            Sign in to a Supabase-backed workspace, or continue in demo mode while the first pilot accounts are being configured.
          </p>
          <div className="mt-8 grid gap-3 text-sm text-slate-300 sm:grid-cols-3">
            <div className="rounded-[8px] border border-white/10 bg-white/5 p-4">
              <p className="font-bold text-white">Roles</p>
              <p className="mt-2">Admin, finance, ops, sales, buyer</p>
            </div>
            <div className="rounded-[8px] border border-white/10 bg-white/5 p-4">
              <p className="font-bold text-white">Persistence</p>
              <p className="mt-2">Orders, payments, and AR in Supabase</p>
            </div>
            <div className="rounded-[8px] border border-white/10 bg-white/5 p-4">
              <p className="font-bold text-white">Payments</p>
              <p className="mt-2">Stripe Checkout when configured</p>
            </div>
          </div>
        </div>
        <Card>
          <div className="space-y-5 text-slate-900">
            <div>
              <p className="text-sm font-semibold text-blue-700">Workspace access</p>
              <h2 className="mt-1 text-2xl font-bold">Choose role and sign in</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Demo mode keeps the walkthrough open. Supabase auth creates the real role record for paid pilots.
              </p>
            </div>

            <div className="grid gap-3">
              <label className="text-sm font-semibold">
                Role
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value as WorkspaceRole)}
                  className="mt-2 w-full rounded-[8px] border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                >
                  {roles.map((item) => (
                    <option key={item} value={item}>{roleLabels[item]}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-semibold">
                Email
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-2 w-full rounded-[8px] border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                />
              </label>
              <label className="text-sm font-semibold">
                Password
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  className="mt-2 w-full rounded-[8px] border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                />
              </label>
            </div>

            {status && (
              <div className="rounded-[8px] border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                {status}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                onClick={signIn}
                disabled={!email || !password || loading !== null}
                className="rounded-[8px] bg-blue-700 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-800 disabled:opacity-40"
              >
                {loading === "signin" ? "Signing in..." : "Sign in"}
              </button>
              <button
                onClick={signUp}
                disabled={!email || !password || loading !== null}
                className="rounded-[8px] border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 disabled:opacity-40"
              >
                {loading === "signup" ? "Creating..." : "Create account"}
              </button>
            </div>

            <Button href={nextPath} variant="secondary">Open selected workspace</Button>
            <button
              onClick={continueDemo}
              disabled={loading !== null}
              className="w-full rounded-[8px] bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
            >
              {loading === "demo" ? "Opening..." : `Continue demo as ${roleLabels[role]}`}
            </button>
          </div>
        </Card>
      </div>
    </main>
  );
}
