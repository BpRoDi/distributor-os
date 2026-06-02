"use client";

import { useEffect, useState } from "react";
import { AppHeader, Button, Card } from "@/components/ui";
import { readApiError } from "@/lib/api/errors";
import {
  acceptDistributorInvite,
  brandStorageKey,
  type DistributorInvite,
} from "@/lib/workspace/tenant";

export default function InviteClient({ token }: { token: string }) {
  const [invite, setInvite] = useState<DistributorInvite | null>(null);
  const [status, setStatus] = useState("Loading invite...");
  const [error, setError] = useState("");
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    loadInvite();
  }, [token]);

  async function loadInvite() {
    setError("");
    try {
      const response = await fetch(`/api/invitations/${token}`, { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        const loaded = normalizeInvite(data.invitation);
        setInvite(loaded);
        setStatus(loaded.status === "accepted" ? "Invite already accepted" : "Invite ready");
        persistInvite(loaded);
        return;
      }

      if (response.status !== 503) {
        setError(await readApiError(response, "Invalid invitation token."));
        setStatus("Invite unavailable");
        return;
      }
    } catch {
      // Local preview invite lookup follows.
    }

    const localInvite = findLocalInvite(token);
    if (localInvite) {
      setInvite(localInvite);
      setStatus(localInvite.status === "accepted" ? "Invite already accepted locally" : "Loaded local invite");
      return;
    }

    setStatus("Invite unavailable");
    setError("Invalid invitation token. Ask the brand for a fresh portal invite.");
  }

  async function acceptInvite() {
    if (!invite) return;
    setAccepting(true);
    setError("");

    try {
      const response = await fetch(`/api/invitations/${token}`, { method: "POST" });
      if (response.ok) {
        const data = await response.json();
        const accepted = normalizeInvite(data.invitation);
        setInvite(accepted);
        setStatus("Invite accepted");
        persistInvite(accepted);
        setAccepting(false);
        return;
      }

      if (response.status !== 503) {
        setError(await readApiError(response, "Invite acceptance failed."));
        setAccepting(false);
        return;
      }
    } catch {
      // Local preview acceptance follows.
    }

    const accepted = acceptDistributorInvite(invite);
    setInvite(accepted);
    setStatus(accepted.status === "accepted" ? "Invite accepted locally" : "Invite expired");
    persistInvite(accepted);
    setAccepting(false);
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <AppHeader title="Portal Invite" subtitle="Accept a brand-scoped order execution workspace invitation." />
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Card>
          <p className="text-sm text-slate-500">Invite token</p>
          <h1 className="mt-2 break-all text-2xl font-bold">{token}</h1>
          <p className="mt-3 text-sm font-semibold text-blue-700">{status}</p>
          {error && (
            <div className="mt-5 rounded-[8px] border border-rose-100 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
              {error}
            </div>
          )}
          {invite && (
            <div className="mt-6 grid gap-3 text-sm md:grid-cols-2">
              <ReadOnly label="Brand" value={invite.brandName} />
              <ReadOnly label="Distributor" value={invite.distributorName} />
              <ReadOnly label="Portal email" value={invite.email} />
              <ReadOnly label="Pricing level" value={`Level ${invite.distributorLevel}`} />
              <ReadOnly label="Status" value={invite.status} />
              <ReadOnly label="Expires" value={new Date(invite.expiresAt).toLocaleDateString()} />
            </div>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={acceptInvite}
              disabled={!invite || invite.status === "accepted" || accepting}
              className="rounded-[8px] bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:bg-slate-300"
            >
              {accepting ? "Accepting..." : invite?.status === "accepted" ? "Invite Accepted" : "Accept Invite"}
            </button>
            <Button href="/portal" variant="secondary">Open Portal</Button>
          </div>
        </Card>
      </div>
    </main>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}

function normalizeInvite(raw: any): DistributorInvite {
  return {
    id: raw.id,
    brandId: raw.brandId || raw.brand_id,
    brandName: raw.brandName || raw.brand_name,
    distributorId: raw.distributorId || raw.distributor_id,
    distributorName: raw.distributorName || raw.distributor_name,
    distributorLevel: raw.distributorLevel || raw.distributor_level || "B",
    email: raw.email,
    token: raw.token,
    inviteUrl: raw.inviteUrl || raw.invite_url,
    status: raw.status || (raw.acceptedAt || raw.accepted_at ? "accepted" : "pending"),
    expiresAt: raw.expiresAt || raw.expires_at,
    acceptedAt: raw.acceptedAt || raw.accepted_at,
    createdAt: raw.createdAt || raw.created_at,
  };
}

function findLocalInvite(token: string) {
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.endsWith(":distributor-invites") && key !== "distributor-os-distributor-invites") continue;
    try {
      const invites = JSON.parse(window.localStorage.getItem(key) || "[]") as DistributorInvite[];
      const invite = invites.find((item) => item.token === token);
      if (invite) return invite;
    } catch {
      // Ignore stale invite cache entries.
    }
  }
  return null;
}

function persistInvite(invite: DistributorInvite) {
  window.localStorage.setItem("distributor-os-accepted-invite", JSON.stringify(invite));
  const key = brandStorageKey(invite.brandId, "distributor-invites");
  const existing = JSON.parse(window.localStorage.getItem(key) || "[]") as DistributorInvite[];
  const next = [invite, ...existing.filter((item) => item.token !== invite.token)];
  window.localStorage.setItem(key, JSON.stringify(next));
}
