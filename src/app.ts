import express, { type Request, type Response } from 'express';
import helmet from 'helmet';
import { clerkContextMiddleware, errorHandler, requestId, requireOperator } from './middleware.js';
import { createOperatorReadRouter, unavailableReadPort } from './operator-read/index.js';

export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(requestId);
app.use(clerkContextMiddleware());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
app.get('/operator/health', requireOperator(), (_req: Request, res: Response) => res.status(200).json({ status: 'ok' }));
app.use('/api/v1', createOperatorReadRouter(unavailableReadPort, requireOperator()));
app.use(errorHandler);
