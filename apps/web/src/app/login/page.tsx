import { Brand } from "@/components/brand";
import SignInForm from "@/components/sign-in-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Brand className="mb-10" />
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1.5 mb-8 text-sm text-muted-foreground">Use the email your invite was sent to.</p>
        <SignInForm />
      </div>
    </main>
  );
}
