import { Router } from 'express';
import { RegistryController } from '../controllers/RegistryController';
import {
    registryHandshakeRateLimiter,
    registryRateLimiter,
    registryStatusRateLimiter
} from '../middlewares/securityMiddleware';

const router = Router();

router.get('/stream/:deviceId', registryRateLimiter, RegistryController.stream);
router.post('/handshake', registryHandshakeRateLimiter, RegistryController.handshake);
router.post('/display-profile', registryRateLimiter, RegistryController.updateDisplayProfile);
router.get('/status/:deviceId', registryStatusRateLimiter, RegistryController.checkStatus);

export default router;
