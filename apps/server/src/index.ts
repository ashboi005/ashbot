import { createApp } from "./app";
import { appDeps } from "./services";

createApp(appDeps).listen(3000, () => {
  console.log("Server is running on http://localhost:3000");
  if (!appDeps.transcribe) console.log("Voice notes: DEEPGRAM_API_KEY is not set, so voice notes are stored without transcripts.");
});
