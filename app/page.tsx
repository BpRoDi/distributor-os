import { Button, Card, StatusBadge } from "@/components/ui";

const outcomes = [
  { label: "Pilot setup", value: "10 days", detail: "Catalog, pricing, distributor seats, and order flow live." },
  { label: "Ops saved", value: "12 hrs/wk", detail: "Less copy-paste across email, spreadsheets, and chat." },
  { label: "Typical first pilot", value: "$2.5K/mo", detail: "Done-with-you setup plus monthly platform fee." },
];

const serviceSteps = [
  "Import SKUs, MOQs, distributor pricing, inventory, and payment terms.",
  "Invite distributors into a private buying portal with approved products only.",
  "Turn chat or email requests into structured orders with review and confirmation.",
  "Track order status, contextual messages, and channel performance in one workspace.",
];

const pricing = [
  { name: "Pilot", price: "$2,500/mo", bestFor: "Brands testing with 3-10 distributors", cta: "Start Pilot" },
  { name: "Growth", price: "$6,000/mo", bestFor: "Brands moving real channel volume", cta: "Book Demo" },
  { name: "Managed", price: "Custom", bestFor: "Brands that want catalog ops handled for them", cta: "Scope Service" },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#f7f9fc] text-slate-950">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div>
            <p className="text-lg font-bold">Distributor OS</p>
            <p className="text-xs text-slate-500">Private B2B ordering portals for growing brands</p>
          </div>
          <nav className="flex items-center gap-3">
            <Button href="/portal" variant="secondary">Portal</Button>
            <Button href="/app">Open Demo</Button>
          </nav>
        </div>
      </header>

      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto grid min-h-[72vh] max-w-7xl gap-10 px-6 py-14 lg:grid-cols-[1.02fr_0.98fr] lg:items-center">
          <div>
            <StatusBadge status="Pilot-ready service" />
            <h1 className="mt-5 max-w-4xl text-4xl font-bold tracking-tight md:text-6xl">
              Launch a branded distributor ordering portal without building one from scratch.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              Distributor OS helps brands replace spreadsheet orders, chat requests, and ad hoc pricing files with a private portal, SKU-matched orders, distributor-specific terms, and a weekly operating rhythm.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="/app">Show Brand Demo</Button>
              <Button href="mailto:hello@distributor-os.com?subject=Distributor%20OS%20pilot" variant="secondary">
                Book Pilot Call
              </Button>
            </div>
          </div>

          <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-4 shadow-xl">
            <Card>
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-500">Brand workspace</p>
                  <h2 className="text-2xl font-bold">Nimbus Home Goods</h2>
                </div>
                <StatusBadge status="Active" />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {outcomes.map((item) => (
                  <div key={item.label} className="rounded-[8px] border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase text-slate-500">{item.label}</p>
                    <p className="mt-2 text-3xl font-bold">{item.value}</p>
                    <p className="mt-2 text-sm leading-5 text-slate-500">{item.detail}</p>
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-[8px] border border-slate-200 bg-slate-950 p-5 text-white">
                <p className="text-sm text-slate-300">Today in the portal</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <Metric label="Orders" value="18" />
                  <Metric label="GMV" value="$186K" />
                  <Metric label="Open risks" value="2" />
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-6 py-14 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">What brands buy</h2>
          <p className="mt-3 text-slate-600">
            A packaged channel-operations service: setup, software, distributor onboarding, and a practical workflow your team can run every week.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {serviceSteps.map((step, index) => (
            <Card key={step}>
              <p className="text-sm font-bold text-blue-700">0{index + 1}</p>
              <p className="mt-3 font-semibold leading-6">{step}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-14">
          <div className="mb-7 flex flex-col justify-between gap-3 md:flex-row md:items-end">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">Simple pilot packaging</h2>
              <p className="mt-2 text-slate-600">Clear enough for a sales call. Flexible enough for real brand operations.</p>
            </div>
            <Button href="mailto:hello@distributor-os.com?subject=Distributor%20OS%20pricing">Ask for Pricing Deck</Button>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {pricing.map((plan) => (
              <Card key={plan.name}>
                <div className="flex min-h-[210px] flex-col">
                  <p className="text-sm font-bold text-blue-700">{plan.name}</p>
                  <p className="mt-3 text-3xl font-bold">{plan.price}</p>
                  <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">{plan.bestFor}</p>
                  <Button href="mailto:hello@distributor-os.com?subject=Distributor%20OS%20pilot" variant={plan.name === "Pilot" ? "primary" : "secondary"}>
                    {plan.cta}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] bg-white/10 p-4 ring-1 ring-white/15">
      <p className="text-xs text-slate-300">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
