import { createAuth } from "@ashbot/auth";
import { createDb } from "@ashbot/db";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);
