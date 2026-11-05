import type { TicketStatus } from "@ashbot/contracts";
import { cn } from "@ashbot/ui/lib/utils";

import { clientStatus, STATUS_STEPS } from "@/lib/format";

// The one memorable element: a thin line with four stops; the current stop pulses while the investigation runs.
export function StatusTrack({ status }: { status: TicketStatus }) {
  const { step, live } = clientStatus(status);
  return (
    <div role="status" aria-label={`Status: ${STATUS_STEPS[step]}`}>
      <ol className="relative grid grid-cols-4">
        <span aria-hidden className="absolute top-[5px] right-[12.5%] left-[12.5%] h-px bg-border" />
        <span
          aria-hidden
          className="absolute top-[5px] left-[12.5%] h-px bg-signal transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${(step / (STATUS_STEPS.length - 1)) * 75}%` }}
        />
        {STATUS_STEPS.map((label, index) => {
          const done = index < step;
          const current = index === step;
          return (
            <li key={label} className="relative flex flex-col items-center gap-2">
              <span
                className={cn(
                  "size-[11px] rounded-full border-2 bg-background",
                  done && "border-signal bg-signal",
                  current && "border-signal",
                  current && live && "signal-pulse bg-signal",
                  !done && !current && "border-border",
                )}
              />
              <span className={cn("text-xs", current ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
