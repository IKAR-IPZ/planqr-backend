import { Router } from 'express';
import { RegistryController } from '../controllers/RegistryController';

const router = Router();

router.post('/handshake', RegistryController.handshake);
router.get('/status/:deviceId', RegistryController.checkStatus);

export default router;
