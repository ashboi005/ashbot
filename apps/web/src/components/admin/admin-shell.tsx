"use client";

import { cn } from "@ashbot/ui/lib/utils";
import { FolderKanban, Inbox, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { AccountMenu } from "@/components/account-menu";
import { Brand } from "@/components/brand";
import { FullPageMessage } from "@/components/full-page-message";
import { ApiRequestError } from "@/lib/api";
import { useMe } from "@/lib/queries";

const NAV = [
  { href: "/admin", label: "Inbox", icon: Inbox, match: (p: string) => p === "/admin" || p.startsWith("/admin/tickets") },
  { href: "/admin/projects", label: "Projects", icon: FolderKanban, match: (p: string) => p.startsWith("/admin/projects") },
  { href: "/admin/clients", label: "Clients", icon: Users, match: (p: string) => p.startsWith("/admin/clients") },
] as const;

export function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: me, error } = useMe();

  useEffect(() => {
    if (error instanceof ApiRequestError && error.status === 401) router.replace("/login");
    if (me && me.role !== "admin") router.replace("/chat");
  }, [error, me, router]);

  if (error && !(error instanceof ApiRequestError && error.status === 401)) return <FullPageMessage title="Can't load your account">{error.message}</FullPageMessage>;
  if (!me || me.role !== "admin") return <FullPageMessage title="Opening the admin panel…" />;

  return (
    <div className="flex h-svh flex-col md:flex-row">
      <aside className="flex shrink-0 items-center gap-1 border-b bg-card px-3 py-2 md:w-52 md:flex-col md:items-stretch md:border-r md:border-b-0 md:px-3 md:py-5">
        <Brand subtitle="admin" className="mr-auto px-2 md:mr-0 md:mb-6" />
        <nav aria-label="Admin" className="flex gap-1 md:grid">
          {NAV.map(({ href, label, icon: Icon, match }) => (
            <Link
              key={href}
              href={href}
              aria-current={match(pathname) ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                match(pathname) && "bg-muted font-medium text-foreground",
              )}
            >
              <Icon className="size-4" />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          ))}
        </nav>
        <div className="ml-2 md:mt-auto md:ml-0 md:px-1">
          <AccountMenu name={me.name} email={me.email} />
        </div>
      </aside>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b px-6 py-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}
