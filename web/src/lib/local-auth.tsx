"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@clerk/nextjs';
import { ApiError } from './api';
import { MutationGuard } from './mutations';
import { clearViewCache } from './view-cache';
export const isLocalOperator = process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_OPERATOR_LOCAL_MODE === 'true';
type Session = {
    token: string;
    profile: {
        id: string;
        label: string;
        role: string;
    };
    session_id: string;
};
type LocalAuth = {
    isLoaded: boolean;
    isSignedIn: boolean;
    userId: string | null;
    orgId: string | null;
    sessionId: string | null;
    getToken: () => Promise<string | null>;
    signOut: () => Promise<void>;
};
const context = createContext<LocalAuth | null>(null);
function useLocalAuth() { const value = useContext(context); if (!value)
    throw new Error('Local operator provider is required.'); return value; }
export const useOperatorAuth = isLocalOperator ? useLocalAuth : useAuth;
export function LocalOperatorProvider({ children }: {
    children: ReactNode;
}) {
    const [session, setSession] = useState<Session | null>(null), [ready, setReady] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
    const guard = useRef(new MutationGuard());
    useEffect(() => { try {
        const stored = sessionStorage.getItem('operator-local-session');
        if (stored) {
            const value = JSON.parse(stored) as Session;
            if (['user_local_founder', 'user_local_ryanny'].includes(value.profile?.id))
                setSession(value);
            else
                sessionStorage.removeItem('operator-local-session');
        }
    }
    catch {
        sessionStorage.removeItem('operator-local-session');
    } setReady(true); }, []);
    const getToken = useCallback(async () => session?.token ?? null, [session]);
    const signOut = useCallback(async () => { sessionStorage.removeItem('operator-local-session'); setSession(null); clearViewCache(); }, []);
    async function login(form: FormData) {
        if (guard.current.isPending)
            return;
        setPending(true);
        setError('');
        try {
            await guard.current.run('local-login', { profile: form.get('profile') }, async (key) => {
                const response = await fetch('http://localhost:5080/local/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ profile: form.get('profile') }) });
                if (!response.ok)
                    throw new ApiError('Local sign-in failed.', 'http');
                const data = await response.json();
                sessionStorage.setItem('operator-local-session', JSON.stringify(data.data));
                setSession(data.data);
            });
        }
        catch {
            setError('Local sign-in failed. Check the Docker API and try again.');
        }
        finally {
            setPending(false);
        }
    }
    const value: LocalAuth = { isLoaded: ready, isSignedIn: !!session, userId: session?.profile.id ?? null, orgId: session ? 'org_local_operator' : null, sessionId: session?.session_id ?? null, getToken, signOut };
    if (!ready)
        return <main className="setup-screen" role="status">Opening local workspace...</main>;
    return <context.Provider value={value}>{session ? children : <main className="setup-screen"><section className="setup-card"><p className="eyebrow">Local Docker workspace</p><h1>Operator sign-in</h1><p>Synthetic businesses and identities. Hosted services are disconnected.</p>{error && <p role="alert">{error}</p>}<form onSubmit={e => { e.preventDefault(); void login(new FormData(e.currentTarget)); }}><label>Local operator<select name="profile" disabled={pending}>{[{ id: 'user_local_founder', label: 'You (Superadmin)' }, { id: 'user_local_ryanny', label: 'Ryanny (Superadmin)' }].map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label><button className="button button-primary" disabled={pending}>{pending ? 'Signing in...' : 'Open local console'}</button></form></section></main>}</context.Provider>;
}
