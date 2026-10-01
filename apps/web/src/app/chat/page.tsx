import { Suspense } from "react";

import { ChatApp } from "@/components/chat/chat-app";

export default function ChatPage() {
  return (
    <Suspense>
      <ChatApp />
    </Suspense>
  );
}
