import "dotenv/config";
import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const discordIdList = z.preprocess((value) => {
  if (value === undefined || value === "") {
    return ["904365027136512021"];
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return value;
}, z.array(z.string().regex(/^\d+$/)).min(1));

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_KEY: z.string().min(1),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: optionalNonEmptyString,
  DISCORD_GUILD_ID: optionalNonEmptyString,
  ADMIN_DISCORD_IDS: discordIdList,
  DISCORD_GATEWAY_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  QUEUE_RESET_TIME: z.string().regex(/^\d{2}:\d{2}$/).default("12:00"),
  RIOT_API_KEY: optionalNonEmptyString,
  RIOT_TOURNAMENT_CODES_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  WEBHOOK_URL: optionalNonEmptyString,
  RIOT_CLIENT_ID: optionalNonEmptyString,
  RIOT_CLIENT_SECRET: optionalNonEmptyString,
  PORT: z.preprocess(
    (value) => (value === undefined ? "8080" : value),
    z.string().regex(/^\d+$/)
  ).transform(Number),
});

export const env = envSchema.parse(process.env);
