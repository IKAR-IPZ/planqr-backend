import { Router } from 'express';
import { RegistryController } from '../controllers/RegistryController';

const router = Router();

router.get('/stream/:deviceId', RegistryController.stream);
router.post('/handshake', RegistryController.handshake);
router.post('/display-profile', RegistryController.updateDisplayProfile);
router.get('/status/:deviceId', RegistryController.checkStatus);

export default router;
