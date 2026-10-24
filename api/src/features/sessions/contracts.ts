export type SessionAuditPort = {
    record(input: {
        subject: string;
        sessionId: string;
        event: 'started' | 'ended' | 'sign_out_requested' | 'revoked' | 'removed';
        requestId: string;
        occurredAt?: string;
    }): Promise<{
        recorded: boolean;
    }>;
    recordDecision(input: {
        subject: string;
        permission: string;
        allowed: boolean;
        requestId: string;
    }): Promise<void>;
    isKnown(subject: string, sessionId: string): Promise<boolean>;
    isEnded(subject: string, sessionId: string): Promise<boolean>;
};
export type { GrantListPort } from '../support-access/contracts.js';
