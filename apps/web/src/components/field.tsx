import { Button } from "@ashbot/ui/components/button";
import { Input } from "@ashbot/ui/components/input";
import { cn } from "@ashbot/ui/lib/utils";
import * as React from "react";

export function TextField({
  label,
  hint,
  error,
  id,
  className,
  ...props
}: React.ComponentProps<"input"> & { label: string; hint?: string; error?: string }) {
  const fieldId = id ?? React.useId();
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={fieldId} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${fieldId}-note` : undefined}
        className="h-10 rounded-lg bg-card px-3 text-sm md:text-sm"
        {...props}
      />
      {error || hint ? (
        <p id={`${fieldId}-note`} className={cn("text-sm", error ? "text-destructive" : "text-muted-foreground")}>
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}

export function PrimaryButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  return <Button className={cn("h-10 rounded-lg px-4 text-sm", className)} {...props} />;
}

export function QuietButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  return <Button variant="ghost" className={cn("h-9 rounded-lg px-3 text-sm", className)} {...props} />;
}
