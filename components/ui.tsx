import Link from "next/link";

export function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-50 text-slate-900">{children}</div>;
}

export function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-[8px] border border-slate-200 bg-white p-6 shadow-sm">{children}</section>;
}

export function Button({
  children,
  href,
  variant = "primary",
  external = false,
}: {
  children: React.ReactNode;
  href?: string;
  variant?: "primary" | "secondary";
  external?: boolean;
}) {
  const classes = variant === "primary"
    ? "bg-blue-700 text-white shadow-lg shadow-blue-200 hover:bg-blue-800"
    : "border border-slate-200 bg-white text-slate-900 hover:bg-slate-50";

  if (href && (external || href.startsWith("http"))) {
    return <a href={href} target="_blank" rel="noreferrer" className={`inline-flex rounded-[8px] px-5 py-3 text-sm font-semibold transition ${classes}`}>{children}</a>;
  }
  if (href) return <Link href={href} className={`inline-flex rounded-[8px] px-5 py-3 text-sm font-semibold transition ${classes}`}>{children}</Link>;
  return <button className={`inline-flex rounded-[8px] px-5 py-3 text-sm font-semibold transition ${classes}`}>{children}</button>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Active: "bg-emerald-50 text-emerald-700",
    Open: "bg-blue-50 text-blue-700",
    Submitted: "bg-amber-50 text-amber-700",
    Confirmed: "bg-blue-50 text-blue-700",
    "Ready to Ship": "bg-indigo-50 text-indigo-700",
    Delivered: "bg-emerald-50 text-emerald-700",
    "Out of Stock": "bg-rose-50 text-rose-700",
    Available: "bg-emerald-50 text-emerald-700"
  };
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${map[status] || "bg-slate-100 text-slate-700"}`}>{status}</span>;
}

export function AppHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="border-b border-slate-200 bg-white px-6 py-4">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">Distributor OS</p>
          <h1 className="text-xl font-bold">{title}</h1>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        <nav className="flex gap-3 text-sm font-semibold">
          <Link href="/app">Dashboard</Link>
          <Link href="/portal">Portal</Link>
          <Link href="/login">Login</Link>
        </nav>
      </div>
    </header>
  );
}
