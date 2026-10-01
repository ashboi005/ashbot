"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { Brand } from "@/components/brand";
import { PrimaryButton, TextField } from "@/components/field";
import { FullPageMessage } from "@/components/full-page-message";
import { api, ApiRequestError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { useInvitePreview } from "@/lib/queries";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: invite, error, isPending } = useInvitePreview(token);
  const [name, setName] = useState<string>();
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  if (isPending) return <FullPageMessage title="Checking your invite…" />;
  if (error || !invite) {
    return (
      <FullPageMessage title="This invite can't be used">
        {error instanceof ApiRequestError ? error.message : "Ask for a new invite link."}{" "}
        <a className="text-foreground underline underline-offset-4" href="/login">
          Go to sign in
        </a>
      </FullPageMessage>
    );
  }

  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Brand className="mb-10" />
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {invite.name.split(" ")[0]}</h1>
        <p className="mt-1.5 mb-8 text-sm text-muted-foreground">
          Set a password to report problems with {invite.projects.length > 0 ? invite.projects.join(", ") : "your projects"} and follow their progress.
        </p>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (password.length < 8) {
              setFormError("Use at least 8 characters.");
              return;
            }
            setSubmitting(true);
            setFormError(undefined);
            try {
              await api(`/api/invites/${token}/accept`, { method: "POST", json: { password, name: name ?? invite.name } });
              await authClient.signIn.email({ email: invite.email, password });
              await qc.invalidateQueries({ queryKey: ["me"] });
              router.replace("/chat");
            } catch (err) {
              setFormError(err instanceof Error ? err.message : "Couldn't create your account.");
              setSubmitting(false);
            }
          }}
        >
          <TextField label="Email" value={invite.email} disabled readOnly />
          <TextField label="Your name" autoComplete="name" required value={name ?? invite.name} onChange={(e) => setName(e.target.value)} />
          <TextField
            label="Password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            hint="At least 8 characters."
            error={formError}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <PrimaryButton type="submit" disabled={submitting} className="mt-2">
            {submitting ? "Creating your account…" : "Create account"}
          </PrimaryButton>
        </form>
      </div>
    </main>
  );
}
