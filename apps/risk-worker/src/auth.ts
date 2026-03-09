import { createClient } from "@supabase/supabase-js";
import type { AppConfig } from "./config";

export interface RequestUser {
  id: string;
  email?: string;
}

export async function authenticateRequest(
  request: Request,
  config: AppConfig,
  requireAuth: boolean
): Promise<RequestUser | null> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;

  if (!token) {
    if (requireAuth) {
      throw new Error("Missing bearer token.");
    }

    return null;
  }

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    if (requireAuth) {
      throw new Error("Supabase auth configuration is missing.");
    }

    return null;
  }

  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: false
    }
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    if (requireAuth) {
      throw new Error("Invalid bearer token.");
    }

    return null;
  }

  return {
    id: data.user.id,
    email: data.user.email
  };
}
