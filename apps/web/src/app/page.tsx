"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { FullPageMessage } from "@/components/full-page-message";
import { ApiRequestError } from "@/lib/api";
import { useMe } from "@/lib/queries";

export default function Home() {
  const router = useRouter();
  const { data: me, error } = useMe();

  useEffect(() => {
    if (me) router.replace(me.role === "admin" ? "/admin" : "/chat");
    else if (error instanceof ApiRequestError && error.status === 401) router.replace("/login");
  }, [me, error, router]);

  if (error && !(error instanceof ApiRequestError && error.status === 401)) {
    return <FullPageMessage title="Can't load your account">{error.message}</FullPageMessage>;
  }
  return <FullPageMessage title="Opening Ashbot…" />;
}
