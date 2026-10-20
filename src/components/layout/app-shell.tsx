"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Sun,
  Wallet,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { cn, formatMoney } from "@/lib/utils";
import { useSelectedRegistrar } from "@/lib/hooks/use-selected-registrar";
import { useCart } from "@/lib/cart";

type NavItem =
  | { href: string; label: string; icon: LucideIcon }
  | { label: string; adminOnly?: boolean; children: Array<{ href: string; label: string }> };

const nav: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  {
    label: "Domains",
    children: [
      { href: "/domains/purchase", label: "Purchase" },
      { href: "/domains/purchased", label: "Purchased" },
    ],
  },
  {
    label: "Infrastructure",
    adminOnly: true,
    children: [
      { href: "/infrastructure/cloudflare", label: "Cloudflare" },
      { href: "/infrastructure/keitaro", label: "Keitaro" },
      { href: "/infrastructure/hestia", label: "Hestia" },
    ],
  },
  {
    label: "Settings",
    adminOnly: true,
    children: [
      { href: "/settings/registrars", label: "Registrars" },
      { href: "/settings/buyers", label: "Buyers" },
      { href: "/settings/registrants", label: "Registrant Profiles" },
      { href: "/settings/servers", label: "Servers" },
      { href: "/settings/users", label: "Users" },
      { href: "/settings/general", label: "General" },
    ],
  },
];

function NavLinks({
  pathname,
  onNavigate,
  isAdmin,
}: {
  pathname: string;
  onNavigate?: () => void;
  isAdmin?: boolean;
}) {
  return (
    <nav className="flex-1 space-y-4 overflow-auto px-3 py-2">
      {nav.filter((item) => isAdmin || !("children" in item) || !item.adminOnly).map((item) =>
        "href" in item ? (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
              pathname === item.href
                ? "bg-white/10 text-white"
                : "text-sidebar-muted hover:bg-white/5 hover:text-white",
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ) : (
          <div key={item.label}>
            <div className="px-2 pb-1 text-[11px] uppercase tracking-wide text-sidebar-muted">{item.label}</div>
            <div className="space-y-0.5">
              {item.children.map((child) => (
                  <Link
                    key={child.href}
                    href={child.href}
                    onClick={onNavigate}
                    className={cn(
                      "block rounded-md px-2 py-1.5 text-sm",
                      pathname === child.href
                        ? "bg-white/10 text-white"
                        : "text-sidebar-muted hover:bg-white/5 hover:text-white",
                    )}
                  >
                    {child.label}
                  </Link>
                ))}
            </div>
          </div>
        ),
      )}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const cartCount = useCart((s) => s.domains.length);
  const { registrarId, registrars, balance, setRegistrar } = useSelectedRegistrar();

  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: { email: string; name?: string | null; role: string } }>("/api/auth/me"),
  });
  const isAdmin = me.data?.user.role === "admin";

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 shrink-0 border-r bg-sidebar text-sidebar-foreground md:flex md:flex-col">
        <div className="flex h-14 items-center gap-2 px-5 text-sm font-semibold tracking-tight">
          <Globe className="h-4 w-4 text-primary" />
          Domain Manager
        </div>
        <NavLinks pathname={pathname} isAdmin={isAdmin} />
      </aside>
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button className="absolute inset-0 bg-black/50" onClick={() => setMenuOpen(false)} aria-label="Close menu" />
          <aside className="relative z-50 flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground shadow-xl">
            <div className="flex h-14 items-center justify-between px-4 text-sm font-semibold">
              <span className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-primary" />
                Domain Manager
              </span>
              <button className="rounded-md p-1 hover:bg-white/10" onClick={() => setMenuOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <NavLinks pathname={pathname} onNavigate={() => setMenuOpen(false)} isAdmin={isAdmin} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b bg-card px-4">
          <div className="flex min-w-0 items-center gap-3">
            <button className="rounded-md p-2 hover:bg-muted md:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
              <Menu className="h-4 w-4" />
            </button>
            <Wallet className="hidden h-4 w-4 text-muted-foreground sm:block" />
            <select
              aria-label="Selected registrar"
              className="h-8 max-w-36 rounded-md border bg-background px-2 text-sm"
              value={registrarId ?? ""}
              onChange={(e) => setRegistrar(e.target.value)}
            >
              {(registrars.data?.registrars ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
              {!registrars.data?.registrars.length && <option value="">No registrar</option>}
            </select>
            <div className="min-w-0 truncate text-sm" title={balance.error instanceof Error ? balance.error.message : undefined}>
              <span className="text-muted-foreground">Balance </span>
              <span className="font-semibold">
                {balance.data?.balance
                  ? formatMoney(balance.data.balance.amount, balance.data.balance.currency)
                  : "—"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {cartCount > 0 && (
              <button
                onClick={() => router.push("/domains/purchase")}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              >
                Cart {cartCount}
              </button>
            )}
            <button
              className="rounded-md p-2 hover:bg-muted"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
            >
              {mounted && resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            {me.data?.user.email && (
              <span className="hidden max-w-40 truncate text-xs text-muted-foreground sm:inline" title={me.data.user.email}>
                {me.data.user.email}
              </span>
            )}
            <button
              className="rounded-md p-2 hover:bg-muted"
              aria-label="Sign out"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                router.push("/login");
              }}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
