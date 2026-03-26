import { Router } from 'express';
import { AdminController } from '../controllers/AdminController';
import { requireAdmin } from '../middlewares/authMiddleware';

const router = Router();

router.use(requireAdmin);

router.get('/', AdminController.listAdmins);
router.post('/', AdminController.createAdmin);
router.delete('/:username', AdminController.deleteAdmin);

export default router;
