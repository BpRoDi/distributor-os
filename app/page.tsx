import { Button, Card, StatusBadge } from "@/components/ui";
import { getPilotCallUrl } from "@/lib/booking";

const outcomes = [
  { label: "First vertical", value: "Rigorer", detail: "Custom team jerseys, shoes, deposits, mockups, and player size collection." },
  { label: "Channels", value: "5+", detail: "WhatsApp, Email, Instagram DM, Telegram, forms, portal links, and imports." },
  { label: "Cash loop", value: "Live", detail: "Approval, deposit request, Stripe Checkout, AR tracking, and payment reconciliation." },
];

const modules = [
  {
    name: "AI Order Intake",
    text: "Capture messy requests and extract SKU, quantity, size, color, deadline, customer type, missing fields, and order intent.",
  },
  {
    name: "Smart Order Builder",
    text: "Create order drafts with pricing tiers, MOQ checks, inventory notes, deposits, discounts, shipping, and risk flags.",
  },
  {
    name: "Payment and Approval Workflow",
    text: "Track contract signed, deposit paid, mockup approved, production started, final payment due, shipped, and delivered.",
  },
  {
    name: "Factory Handoff",
    text: "Generate production-ready sheets with SKU, size, color, quantity, logo files, notes, deadline, and shipping address.",
  },
];

const templates = [
  "Sports Team Order",
  "Wholesale Reorder",
  "Custom Apparel / Merch Order",
  "Sample Order",
];

const whoItIsFor = [
  "Brand agents",
  "Distributors",
  "Small and mid-size brands",
  "Custom apparel teams",
  "Sports brands",
  "Wholesale sales teams",
  "Teams still using Excel, Google Forms, WhatsApp, and Stripe separately",
];

const pricing = [
  { name: "Pilot", price: "$2,500/mo", bestFor: "One brand, one template, 3-10 customers or distributors", cta: "Start Pilot" },
  { name: "Growth", price: "$6,000/mo", bestFor: "Brands moving real B2B order volume across several channels", cta: "Book Demo" },
  { name: "Managed", price: "Custom", bestFor: "Brands that want catalog, template, and launch operations handled", cta: "Scope Service" },
];

export default function LandingPage() {
  const heroPilotCallUrl = getPilotCallUrl("landing-hero");

  return (
    <main className="min-h-screen bg-[#f7f9fc] text-slate-950">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div>
            <p className="text-lg font-bold">Distributor OS</p>
            <p className="text-xs text-slate-500">AI B2B Order Execution OS for brands, distributors, and agents</p>
          </div>
          <nav className="flex items-center gap-3">
            <Button href="/portal" variant="secondary">Portal</Button>
            <Button href="/app">Open Demo</Button>
          </nav>
        </div>
      </header>

      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto grid min-h-[72vh] max-w-7xl gap-10 px-6 py-14 lg:grid-cols-[1fr_0.95fr] lg:items-center">
          <div>
            <StatusBadge status="Rigorer first vertical" />
            <h1 className="mt-5 max-w-5xl text-4xl font-bold tracking-tight md:text-6xl">
              Turn messy B2B sales conversations into confirmed, paid, and trackable orders.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              Distributor OS helps brands, distributors, and sales agents convert WhatsApp, Email, Instagram DM, and form requests into accurate orders, payment milestones, production files, and follow-up workflows.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="/app">Show Rigorer Demo</Button>
              <Button href={heroPilotCallUrl} variant="secondary" external>
                Book Pilot Call
              </Button>
            </div>
          </div>

          <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-4 shadow-xl">
            <Card>
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-500">First launch workspace</p>
                  <h2 className="text-2xl font-bold">Rigorer team customization</h2>
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
                <p className="text-sm text-slate-300">B2B orders do not start as clean carts</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <Metric label="AI drafts" value="3" />
                  <Metric label="Cash waiting" value="$11.6K" />
                  <Metric label="Risk flags" value="4" />
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-6 py-14 lg:grid-cols-[0.85fr_1.15fr]">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">What the product controls</h2>
          <p className="mt-3 text-slate-600">
            Nuanced B2B execution after the conversation starts: intake, templates, approvals, deposits, production handoff, customer follow-up, and payment visibility.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {modules.map((module, index) => (
            <Card key={module.name}>
              <p className="text-sm font-bold text-blue-700">0{index + 1}</p>
              <p className="mt-3 font-semibold leading-6">{module.name}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">{module.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 py-14 lg:grid-cols-[1fr_1fr]">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Workflow templates, not one hard-coded order type</h2>
            <p className="mt-3 text-slate-600">
              Sports Team Orders are the first focused template for Rigorer. The same engine can run wholesale reorders, custom merch, and sample workflows.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((template) => (
              <div key={template} className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
                <p className="font-semibold">{template}</p>
                <p className="mt-2 text-sm text-slate-500">Configurable fields, milestones, payment rules, and follow-up actions.</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-6 py-14 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Why now</h2>
          <p className="mt-3 text-slate-600">
            B2B orders do not start as clean carts. They start as messy conversations, partial files, screenshots, price questions, and payment promises.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {whoItIsFor.map((item) => (
            <div key={item} className="rounded-[8px] border border-slate-200 bg-white px-4 py-3 text-sm font-semibold shadow-sm">
              {item}
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-14">
          <div className="mb-7 flex flex-col justify-between gap-3 md:flex-row md:items-end">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">Simple pilot packaging</h2>
              <p className="mt-2 text-slate-600">Start with Rigorer team customization, then expand templates after the first workflow is clean.</p>
            </div>
            <Button href={getPilotCallUrl("landing-pricing")} external>Book Pilot Call</Button>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {pricing.map((plan) => (
              <Card key={plan.name}>
                <div className="flex min-h-[210px] flex-col">
                  <p className="text-sm font-bold text-blue-700">{plan.name}</p>
                  <p className="mt-3 text-3xl font-bold">{plan.price}</p>
                  <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">{plan.bestFor}</p>
                  <Button href={getPilotCallUrl(`landing-${plan.name.toLowerCase()}`)} variant={plan.name === "Pilot" ? "primary" : "secondary"} external>
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
