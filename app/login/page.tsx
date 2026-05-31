import { Button, Card } from "@/components/ui";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
      <div className="grid max-w-6xl gap-8 lg:grid-cols-[1fr_460px] lg:items-center">
        <div>
          <p className="mb-6 inline-flex rounded-[8px] bg-white/10 px-4 py-3 text-sm font-bold">Distributor OS</p>
          <h1 className="max-w-2xl text-4xl font-bold md:text-6xl">Brand and distributor access.</h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
            Open the Nimbus Home Goods pilot workspace, review source-backed orders, and preview the distributor portal with approved pricing.
          </p>
          <div className="mt-8 grid gap-3 text-sm text-slate-300 sm:grid-cols-3">
            <div className="rounded-[8px] border border-white/10 bg-white/5 p-4">
              <p className="font-bold text-white">Brand workspace</p>
              <p className="mt-2">Catalog, levels, orders, invites</p>
            </div>
            <div className="rounded-[8px] border border-white/10 bg-white/5 p-4">
              <p className="font-bold text-white">Distributor portal</p>
              <p className="mt-2">Approved catalog and tier prices</p>
            </div>
            <div className="rounded-[8px] border border-white/10 bg-white/5 p-4">
              <p className="font-bold text-white">Pilot mode</p>
              <p className="mt-2">Local preview or Supabase-backed</p>
            </div>
          </div>
        </div>
        <Card>
          <div className="space-y-5 text-slate-900">
            <div>
              <p className="text-sm font-semibold text-blue-700">Pilot access</p>
              <h2 className="mt-1 text-2xl font-bold">Choose workspace role</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Use these preview roles for demos. In production this connects to Supabase Auth and brand-specific user permissions.
              </p>
            </div>
            <div className="grid gap-3">
              <Button href="/app">Brand Admin</Button>
              <Button href="/portal" variant="secondary">Distributor Portal</Button>
            </div>
            <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-4 text-sm">
              <p className="font-semibold">Accepted an invite?</p>
              <p className="mt-1 text-slate-500">Open the Distributor Portal to continue with the accepted distributor level.</p>
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
