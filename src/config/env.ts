import "dotenv/config";
import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_KEY: z.string().min(1),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: optionalNonEmptyString,
  DISCORD_GUILD_ID: optionalNonEmptyString,
  DISCORD_GATEWAY_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  QUEUE_RESET_TIME: z.string().regex(/^\d{2}:\d{2}$/).default("12:00"),
  RIOT_API_KEY: optionalNonEmptyString,
  WEBHOOK_URL: optionalNonEmptyString,
  RIOT_CLIENT_ID: optionalNonEmptyString,
  RIOT_CLIENT_SECRET: optionalNonEmptyString,
  PORT: z.preprocess(
    (value) => (value === undefined ? "8080" : value),
    z.string().regex(/^\d+$/)
  ).transform(Number),
});

export const env = envSchema.parse(process.env);
