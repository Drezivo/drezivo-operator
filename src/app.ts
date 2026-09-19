import express, { type Request, type Response } from 'express';
import helmet from 'helmet';
import { clerkContextMiddleware, errorHandler, requestId, requireOperator } from './middleware.js';
import { createOperatorReadRouter, unavailableReadPort } from './operator-read/index.js';
import { createOperatorBillingRouter, unavailableBillingReadPort } from './operator-billing/index.js';
import { createOperatorAuditRouter, unavailableAuditPort } from './operator-audit/index.js';
import { createOperatorDirectoryRouter, unavailableOperatorDirectoryPort } from './operator-directory/index.js';
import { createOperatorSupportActivityRouter, unavailableSupportActivityPort } from './operator-support-activity/index.js';
import { createOperatorOperationsRouter, unavailableOperationsPort } from './operator-operations/index.js';

export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(requestId);
app.use(clerkContextMiddleware());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
app.get('/operator/health', requireOperator(), (_req: Request, res: Response) => res.status(200).json({ status: 'ok' }));
app.use('/api/v1', createOperatorReadRouter(unavailableReadPort, requireOperator()));
app.use('/api/v1', createOperatorBillingRouter(unavailableBillingReadPort, requireOperator()));
app.use('/api/v1', createOperatorAuditRouter(unavailableAuditPort, requireOperator()));
app.use('/api/v1', createOperatorDirectoryRouter(unavailableOperatorDirectoryPort, requireOperator()));
app.use('/api/v1', createOperatorSupportActivityRouter(unavailableSupportActivityPort, requireOperator()));
app.use('/api/v1', createOperatorOperationsRouter(unavailableOperationsPort, requireOperator()));
app.use(errorHandler);
