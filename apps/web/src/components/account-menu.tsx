"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ashbot/ui/components/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";

export function AccountMenu({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { resolvedTheme, setTheme } = useTheme();
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {initials || "?"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56 bg-popover">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-sm">
            <span className="block font-medium text-foreground">{name}</span>
            <span className="block font-normal">{email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-sm" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
            {resolvedTheme === "dark" ? <Sun /> : <Moon />}
            {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-sm"
            variant="destructive"
            onClick={async () => {
              await authClient.signOut();
              qc.clear();
              router.replace("/login");
            }}
          >
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
