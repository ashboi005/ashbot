// Creates the first admin account: bun run admin:create --email you@example.com --name "You" --password "..."
import { parseArgs } from "node:util";

import { auth } from "../services";

const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" }, password: { type: "string" } } });
if (!values.email || !values.name || !values.password || values.password.length < 8) {
  console.log('Usage: bun run admin:create --email you@example.com --name "Your Name" --password "at-least-8-chars"');
  process.exit(2);
}

try {
  const { user } = await auth.api.createUser({ body: { email: values.email, name: values.name, password: values.password, role: "admin" } });
  console.log(`Admin created: ${user.email}`);
  process.exit(0);
} catch (err) {
  console.error(`Could not create the admin: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
