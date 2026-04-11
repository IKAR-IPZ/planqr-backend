import { randomBytes } from 'crypto';

export const generateDeviceSecret = () => randomBytes(18).toString('base64url');
