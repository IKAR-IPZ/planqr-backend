import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';
import { authRateLimiter } from '../middlewares/securityMiddleware';

const router = Router();

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Log in with LDAP credentials
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', authRateLimiter, AuthController.login);

/**
 * @swagger
 * /api/auth/check-login:
 *   get:
 *     summary: Check if user is logged in
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: User is logged in
 *       401:
 *         description: Not logged in
 */
router.get('/check-login', authRateLimiter, AuthController.checkLogin);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Log out
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Logout successful
 */
router.post('/logout', authRateLimiter, AuthController.logout);

export default router;
