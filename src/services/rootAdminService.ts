import { timingSafeEqual } from 'crypto';
import { env } from '../config/env';

const normalizeUsername = (value: string) => value.trim().toLowerCase();

export const getRootAdminLogin = () =>
    env.ROOT_ADMIN_LOGIN ? normalizeUsername(env.ROOT_ADMIN_LOGIN) : null;

export const isRootAdminEnabled = () =>
    Boolean(getRootAdminLogin() && env.ROOT_ADMIN_PASSWORD);

export const isRootAdminLogin = (username?: string | null) => {
    const rootAdminLogin = getRootAdminLogin();
    return Boolean(rootAdminLogin && username && normalizeUsername(username) === rootAdminLogin);
};

const safeEqual = (left: string, right: string) => {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
};

export const verifyRootAdminCredentials = (username: string, password: string) => {
    if (!isRootAdminEnabled() || !env.ROOT_ADMIN_PASSWORD || !isRootAdminLogin(username)) {
        return false;
    }

    return safeEqual(password, env.ROOT_ADMIN_PASSWORD);
};
