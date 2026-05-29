import { AppHeader, Button, Card } from "@/components/ui";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <AppHeader title="Distributor Invite" subtitle="Accept a private portal invitation." />
      <div className="mx-auto max-w-xl px-6 py-12">
        <Card>
          <p className="text-sm text-slate-500">Invite token</p>
          <h1 className="mt-2 break-all text-2xl font-bold">{token}</h1>
          <p className="mt-4 text-slate-600">In production this page validates the invitation token, creates the distributor user, and connects them to the brand workspace.</p>
          <div className="mt-6"><Button href="/portal">Accept Invite</Button></div>
        </Card>
      </div>
    </main>
  );
}
