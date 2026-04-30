import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import type { Database } from "../core/models/database.js";

export const supabase = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
