"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

import { PrimaryButton, TextField } from "./field";

export default function SignInForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(undefined);
        const { error: signInError } = await authClient.signIn.email({ email, password });
        setPending(false);
        if (signInError) {
          setError(signInError.status === 401 ? "That email and password don't match." : (signInError.message ?? "Couldn't sign in. Try again."));
          return;
        }
        await qc.invalidateQueries({ queryKey: ["me"] });
        router.replace("/");
      }}
    >
      <TextField label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <TextField
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={error}
      />
      <PrimaryButton type="submit" disabled={pending} className="mt-2">
        {pending ? "Signing in…" : "Sign in"}
      </PrimaryButton>
    </form>
  );
}
