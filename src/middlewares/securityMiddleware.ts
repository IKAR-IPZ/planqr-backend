import { Request, Response, NextFunction } from 'express';

interface RateLimitBucket {
    count: number;
    resetAt: number;
}

interface RateLimitOptions {
    name: string;
    windowMs: number;
    max: number;
    keyPrefix?: string;
    keyGenerator?: (req: Request) => string;
}

const buckets = new Map<string, RateLimitBucket>();
let lastCleanupAt = 0;

const CLEANUP_INTERVAL_MS = 60 * 1000;

const getClientIp = (req: Request) => {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
        return forwardedFor.split(',')[0].trim();
    }

    if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
        return forwardedFor[0];
    }

    return req.ip || req.socket.remoteAddress || 'unknown';
};

const cleanupBuckets = () => {
    const now = Date.now();
    if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) {
        return;
    }

    lastCleanupAt = now;
    for (const [key, bucket] of Array.from(buckets.entries())) {
        if (bucket.resetAt <= now) {
            buckets.delete(key);
        }
    }
};

export const applyBasicSecurityHeaders = (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

    next();
};

export const createRateLimiter = (options: RateLimitOptions) => {
    const keyPrefix = options.keyPrefix ?? options.name;

    return (req: Request, res: Response, next: NextFunction) => {
        cleanupBuckets();

        const now = Date.now();
        const rawKey = options.keyGenerator ? options.keyGenerator(req) : getClientIp(req);
        const key = `${keyPrefix}:${rawKey}`;

        const existingBucket = buckets.get(key);
        if (!existingBucket || existingBucket.resetAt <= now) {
            buckets.set(key, {
                count: 1,
                resetAt: now + options.windowMs
            });
            next();
            return;
        }

        existingBucket.count += 1;

        if (existingBucket.count > options.max) {
            const retryAfterSeconds = Math.max(1, Math.ceil((existingBucket.resetAt - now) / 1000));
            res.setHeader('Retry-After', retryAfterSeconds.toString());
            res.status(429).json({
                message: 'Too many requests. Please try again later.',
                code: 'RATE_LIMITED',
                scope: options.name
            });
            return;
        }

        next();
    };
};

export const authRateLimiter = createRateLimiter({
    name: 'auth',
    windowMs: 60 * 1000,
    max: 10
});

export const scheduleRateLimiter = createRateLimiter({
    name: 'schedule',
    windowMs: 60 * 1000,
    max: 120
});

export const publicMessagesRateLimiter = createRateLimiter({
    name: 'public-messages',
    windowMs: 60 * 1000,
    max: 120
});

export const registryRateLimiter = createRateLimiter({
    name: 'registry',
    windowMs: 60 * 1000,
    max: 180
});

export const registryHandshakeRateLimiter = createRateLimiter({
    name: 'registry-handshake',
    windowMs: 60 * 1000,
    max: 30
});

export const registryStatusRateLimiter = createRateLimiter({
    name: 'registry-status',
    windowMs: 60 * 1000,
    max: 120
});

export const attendanceScanRateLimiter = createRateLimiter({
    name: 'attendance-scan',
    windowMs: 60 * 1000,
    max: 60
});

export const publicStatusRateLimiter = createRateLimiter({
    name: 'public-status',
    windowMs: 60 * 1000,
    max: 30
});

export const getRequestClientIp = getClientIp;
