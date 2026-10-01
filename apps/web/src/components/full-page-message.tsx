import { Brand } from "./brand";

export function FullPageMessage({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 text-center">
      <Brand />
      <div className="max-w-sm space-y-2">
        <h1 className="text-lg font-semibold">{title}</h1>
        {children ? <div className="text-sm text-muted-foreground">{children}</div> : null}
      </div>
    </main>
  );
}
