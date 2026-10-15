import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupportAccessPanel } from './SupportAccessPanel';
import { GrantHistory } from './GrantHistory';
import { clearViewCache } from '@/lib/view-cache';

const tenant = '11111111-1111-4111-8111-111111111111', grant = '22222222-2222-4222-8222-222222222222';
const getToken = async () => 'local-test-session';
const access = { grant_id: grant, tenant_id: tenant, business_name: 'Local Luna', operator_subject: 'user_local_founder', granted_by: 'user_local_founder', permission_codes: ['workspace.read', 'workspace.repair'], starts_at: '2026-10-15T10:00:00Z', expires_at: '2126-10-15T12:00:00Z', status: 'active' };
const reply = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data, request_id: 'support-ui-test' }), { status });
function mockApi(items: typeof access[] = []) {
  let revoked = false;
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (options?.method === 'POST' && String(url).endsWith('/workspace')) return reply({ grant_id: grant, tenant_id: tenant, mode: JSON.parse(String(options?.body)).mode, expires_at: access.expires_at });
    if (options?.method === 'POST' && String(url).endsWith('/revoke')) { revoked = true; return reply({ ...access, status: 'revoked' }); }
    if (String(url).endsWith('/tenants')) return reply({ items: [{ tenant_id: tenant, name: 'Local Luna', slug: 'local-luna' }] });
    return reply({ items: revoked ? items.map(g => ({...g,status: 'revoked'})) : items, next_cursor: null });
  });
  vi.stubGlobal('fetch', fetcher); return fetcher;
}
beforeEach(() => { clearViewCache(); vi.stubEnv('NEXT_PUBLIC_DREZIVO_API_BASE_URL', 'http://localhost:5080/api/v1'); });
afterEach(() => { cleanup(); clearViewCache(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('recognizable support permissions and access management', () => {
  it('shows business names and readable permission selections without asking for codes or IDs', async () => {
    mockApi(); render(<SupportAccessPanel getToken={getToken} currentOperatorId="user_local_founder" onKeepSidebarScroll={() => {}} />);
    await screen.findByRole('option', { name: /Local Luna/ });
    expect(screen.getByRole('checkbox', { name: /View workspace records/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Allow corrections/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Create support access' })).toBeDisabled();
    expect(screen.queryByRole('textbox', { name: /Permission codes|tenant ID|grant ID/ })).not.toBeInTheDocument();
  });
  it('creates one repair grant on double-submit using only the selected business and readable choices', async () => {
    const fetcher = mockApi(); render(<SupportAccessPanel getToken={getToken} currentOperatorId="user_local_founder" onKeepSidebarScroll={() => {}} />);
    await screen.findByRole('option', { name: /Local Luna/ });
    fireEvent.change(screen.getByRole('combobox', { name: 'Business' }), { target: { value: tenant } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Allow corrections/ }));
    fireEvent.change(screen.getByRole('textbox', { name: /Support reason/ }), { target: { value: 'Investigate incorrect local encoding' } });
    const submit = screen.getByRole('button', { name: 'Create support access' }); fireEvent.click(submit); fireEvent.click(submit);
    expect(await screen.findByRole('heading', { name: 'Repair access is ready' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open workspace' })).toHaveAttribute('href', `/?view=clients&client=${tenant}&workspaceGrant=${grant}`);
    const writes = fetcher.mock.calls.filter(([, options]) => options?.method === 'POST'); expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0]?.[1]?.body))).toEqual({ mode: 'repair', reason: 'Investigate incorrect local encoding', minutes: 30 });
    expect(new Headers(writes[0]?.[1]?.headers).get('Idempotency-Key')).toBeTruthy();
  });
  it('keeps choices and reuses the intent after an uncertain request failure', async () => {
    const fetcher = mockApi(); let failed = false;
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url, options) => { if (options?.method === 'POST' && !failed) { failed = true; throw new TypeError('Synthetic network interruption'); } return original(url, options); });
    render(<SupportAccessPanel getToken={getToken} onKeepSidebarScroll={() => {}} />);
    await screen.findByRole('option', { name: /Local Luna/ });
    fireEvent.change(screen.getByRole('combobox', { name: 'Business' }), { target: { value: tenant } });
    fireEvent.change(screen.getByRole('textbox', { name: /Support reason/ }), { target: { value: 'Inspect local item' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create support access' })); await screen.findByRole('alert');
    expect(screen.getByRole('combobox', { name: 'Business' })).toHaveValue(tenant);
    expect(screen.getByRole('textbox', { name: /Support reason/ })).toHaveValue('Inspect local item');
    fireEvent.click(screen.getByRole('button', { name: 'Create support access' })); await screen.findByRole('heading', { name: 'Read-only access is ready' });
    const writes = fetcher.mock.calls.filter(([, options]) => options?.method === 'POST'); expect(writes).toHaveLength(2);
    expect(new Headers(writes[0]?.[1]?.headers).get('Idempotency-Key')).toBe(new Headers(writes[1]?.[1]?.headers).get('Idempotency-Key'));
  });
  it('revokes the selected row once and does not require a memorized grant ID', async () => {
    const fetcher = mockApi([access]); render(<GrantHistory getToken={getToken} currentOperatorId="user_local_founder" />);
    const row = await screen.findByRole('row', { name: /Local Luna.*You.*View workspace records/ });
    expect(within(row).getByRole('link', { name: 'Open workspace' })).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke access' }));
    expect(within(row).getByText('Revoke your access to Local Luna?')).toBeInTheDocument();
    const confirm = within(row).getByRole('button', { name: 'Confirm revoke' }); fireEvent.click(confirm); fireEvent.click(confirm);
    await screen.findByText('Access to Local Luna revoked.');
    await waitFor(() => expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1));
    expect(fetcher.mock.calls.find(([, options]) => options?.method === 'POST')?.[0]).toContain(`/support-grants/${grant}/revoke`);
  });
  it('does not offer another operator grant as an open workspace session', async () => {
    mockApi([access]); render(<GrantHistory getToken={getToken} currentOperatorId="user_local_ryanny" />);
    await screen.findByRole('button', { name: 'Revoke access' });
    expect(screen.queryByRole('link', { name: 'Open workspace' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke access' })); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Confirm revoke' })).not.toBeInTheDocument();
  });
  it('keeps business selection unavailable when the directory cannot load', async () => {
    mockApi(); vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Synthetic unavailable service' }, request_id: 'failed-list' }), { status: 503 })));
    render(<SupportAccessPanel getToken={getToken} onKeepSidebarScroll={() => {}} />);
    await screen.findByText('Could not load businesses.');
    expect(screen.getByRole('combobox', { name: 'Business' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create support access' })).toBeDisabled();
  });
});
