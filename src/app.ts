import express from 'express';
import helmet from 'helmet';
import { errorHandler, requestId, requireOperator } from './middleware.js';

export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(requestId);
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
app.get('/operator/health', requireOperator, (_req, res) => res.status(200).json({ status: 'ok' }));
app.use(errorHandler);
