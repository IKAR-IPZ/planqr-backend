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
    DEV_AUTH_BYPASS: z
        .string()
        .optional()
        .default("false")
        .refine((value) => value === "true" || value === "false", {
            message: "DEV_AUTH_BYPASS must be set to true or false",
        })
        .transform((value) => value === "true"),
    BACKEND_PUBLIC_URL: z.string().url(),
    CORS_ORIGIN: z.string().min(1, "CORS_ORIGIN is required"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
    ROOT_ADMIN_LOGIN: z.preprocess(
        (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
        z.string().trim().min(1).optional()
    ),
    ROOT_ADMIN_PASSWORD: z.preprocess(
        (value) => value === "" ? undefined : value,
        z.string().min(1).optional()
    ),
    LDAP_URL: z.string().min(1, "LDAP_URL is required"),
    LDAP_DN: z.string().min(1, "LDAP_DN is required"),
    LDAP_SYNC_ENABLED: z
        .string()
        .optional()
        .default("false")
        .refine((value) => value === "true" || value === "false", {
            message: "LDAP_SYNC_ENABLED must be set to true or false",
        })
        .transform((value) => value === "true"),
    LDAP_SYNC_SEARCH_BASE_DN: z.string().optional(),
    LDAP_SYNC_MODE: z.enum(["known", "all"]).optional().default("all"),
    LDAP_SYNC_FULL_FILTER: z.string().optional().default("(uid=*)"),
    LDAP_SYNC_FULL_PAGE_SIZE: z.coerce.number().int().positive().max(1000).optional().default(500),
    LDAP_SYNC_FULL_USER_LIMIT: z.coerce.number().int().min(0).optional().default(0),
    LDAP_SYNC_KNOWN_USER_LIMIT: z.coerce.number().int().positive().optional().default(2000),
    LDAP_SYNC_BATCH_SIZE: z.coerce.number().int().positive().max(100).optional().default(50),
    ZUT_SCHEDULE_STUDENT_URL: z.string().url(),
    WORKER_SECRET_TOKEN: z.string().optional(),
}).superRefine((value, ctx) => {
    if (value.DEV_AUTH_BYPASS && value.NODE_ENV !== "development") {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["DEV_AUTH_BYPASS"],
            message: "DEV_AUTH_BYPASS can only be enabled when NODE_ENV=development",
        });
    }

    if (Boolean(value.ROOT_ADMIN_LOGIN) !== Boolean(value.ROOT_ADMIN_PASSWORD)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["ROOT_ADMIN_LOGIN"],
            message: "ROOT_ADMIN_LOGIN and ROOT_ADMIN_PASSWORD must be configured together",
        });
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["ROOT_ADMIN_PASSWORD"],
            message: "ROOT_ADMIN_LOGIN and ROOT_ADMIN_PASSWORD must be configured together",
        });
    }
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
