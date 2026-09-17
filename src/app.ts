import express, { type Request, type Response } from 'express';
import helmet from 'helmet';
import { clerkContextMiddleware, errorHandler, requestId, requireOperator } from './middleware.js';

export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(requestId);
app.use(clerkContextMiddleware());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
app.get('/operator/health', requireOperator(), (_req: Request, res: Response) => res.status(200).json({ status: 'ok' }));
app.use(errorHandler);
