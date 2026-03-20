import dotenv from "dotenv";
import path from "path";
import { z } from "zod";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config();

const envSchema = z.object({
    NODE_ENV: z.enum(["development", "production", "test"]),
    PORT: z.coerce.number().int().positive(),
    DISABLE_HTTPS: z
        .string()
        .refine((value) => value === "true" || value === "false", {
            message: "DISABLE_HTTPS must be set to true or false",
        })
        .transform((value) => value === "true"),
    BACKEND_PUBLIC_URL: z.string().url(),
    CORS_ORIGIN: z.string().min(1, "CORS_ORIGIN is required"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
    LDAP_URL: z.string().min(1, "LDAP_URL is required"),
    LDAP_DN: z.string().min(1, "LDAP_DN is required"),
    ZUT_SCHEDULE_STUDENT_URL: z.string().url(),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
    console.error("Invalid environment configuration:", parsedEnv.error.flatten().fieldErrors);
    throw new Error("Environment validation failed");
}

const config = parsedEnv.data;

const corsOrigin =
    config.CORS_ORIGIN === "*"
        ? true
        : config.CORS_ORIGIN.split(",")
              .map((origin) => origin.trim())
              .filter(Boolean);

export const env = {
    ...config,
    CORS_ORIGIN: corsOrigin,
};
