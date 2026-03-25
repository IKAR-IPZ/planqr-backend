import { Router } from 'express';
import { LessonController } from '../controllers/LessonController';
import { requireAdmin } from '../middlewares/authMiddleware';

const router = Router();
router.use(requireAdmin);

router.get('/messages/list', LessonController.getMessages);
router.get('/message/:roomId', LessonController.getMessage);
router.delete('/messages/clear', LessonController.clearMessages);
router.delete('/message/delete/:roomId', LessonController.deleteMessage);

export default router;
