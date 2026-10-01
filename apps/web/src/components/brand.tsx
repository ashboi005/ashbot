import { cn } from "@ashbot/ui/lib/utils";

export function Brand({ className, subtitle }: { className?: string; subtitle?: string }) {
  return (
    <div className={cn("flex items-baseline gap-2", className)}>
      <span className="relative inline-flex items-center gap-1.5 text-[15px] font-semibold tracking-tight">
        <span aria-hidden className="size-2 rounded-full bg-signal" />
        Ashbot
      </span>
      {subtitle ? <span className="text-sm text-muted-foreground">{subtitle}</span> : null}
    </div>
  );
}
