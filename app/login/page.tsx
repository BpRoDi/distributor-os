import { Button, Card } from "@/components/ui";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
      <div className="grid max-w-6xl gap-8 lg:grid-cols-[1fr_440px] lg:items-center">
        <div>
          <p className="mb-6 inline-flex rounded-2xl bg-white/10 px-4 py-3 font-bold">Distributor OS Lite</p>
          <h1 className="text-4xl font-bold md:text-6xl">Open the alpha app.</h1>
          <p className="mt-6 text-lg text-slate-300">Use this route as the starting point for Supabase Auth.</p>
        </div>
        <Card>
          <div className="space-y-3 text-slate-900">
            <h2 className="text-2xl font-bold">Choose Preview Role</h2>
            <Button href="/app">Brand Admin</Button>
            <Button href="/portal" variant="secondary">Distributor Portal</Button>
          </div>
        </Card>
      </div>
    </main>
  );
}
