import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePanel } from '@/features/support-access/components/WorkspacePanel';

const tenant = '11111111-1111-4111-8111-111111111111', grant = '22222222-2222-4222-8222-222222222222', item = '33333333-3333-4333-8333-333333333333';
const token = async () => 'synthetic-local-session';
const reply = (data: unknown) => new Response(JSON.stringify({ success: true, data, request_id: 'workspace-ui-test' }), { status: 200 });
const records = { resource: 'clothing', columns: ['id', 'name', 'code'], editable: ['name', 'code'], deletable: true, items: [{ id: item, name: 'Wrong encoding', code: 'LOCAL-ITEM' }], next_cursor: null };
function mockApi(mode: 'read' | 'repair', block = false) {
  const fetcher = vi.fn<typeof fetch>(async (path, options) => {
    const url = String(path);
    if (options?.method === 'POST' && url.endsWith('/workspace')) return reply({ grant_id: grant, tenant_id: tenant, mode, operator_subject: 'user_local_ryanny', expires_at: '2126-10-15T12:00:00Z' });
    if (url.endsWith(`/workspace/${grant}`)) return reply({ grant_id:grant,tenant_id:tenant,mode,operator_subject:'user_local_ryanny',expires_at:'2126-10-15T12:00:00Z' });
    if (url.endsWith('/delete-preview')) return reply({ id: item, name: 'Wrong encoding', code: 'LOCAL-ITEM', fingerprint: 'a'.repeat(64), variants: 1, assets: 2, images: 0, blockers: { reservation_lines: block ? 1 : 0 }, can_delete: !block });
    if (url.endsWith('/delete')) return reply({ id: item, deleted: true, variants: 1, assets: 2, images: 0 });
    if (url.endsWith('/correct')) return reply({ id: item, corrected: true });
    if (url.endsWith('/close')) return reply({ grant_id: grant, closed: true });
    if (url.endsWith(`/clothing/${item}`)) return reply({ id: item, fingerprint: 'a'.repeat(64), data: records.items[0], editable: ['name', 'code'] });
    return reply(records);
  });
  vi.stubGlobal('fetch', fetcher); return fetcher;
}
async function open(mode: 'read' | 'repair') {
  render(<WorkspacePanel tenantId={tenant} businessName="Local test workspace" token={token} />);
  if (mode === 'repair') fireEvent.click(screen.getByRole('checkbox', { name: /Allow corrections and clothing deletion/ }));
  fireEvent.change(screen.getByLabelText('Support reason'), { target: { value: 'Investigate synthetic clothing mistake' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
  await screen.findByText('Wrong encoding');
}
beforeEach(() => vi.stubEnv('NEXT_PUBLIC_DREZIVO_API_BASE_URL', 'http://localhost:5080/api/v1'));
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('workspace operator UI', () => {
  it('shows workspace scope and identity but no correction or deletion controls in read-only access', async () => {
    mockApi('read'); await open('read');
    expect(screen.getByText(`Workspace ${tenant}`)).toBeInTheDocument();
    expect(screen.getByText(/Operator user_local_ryanny/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete permanently…' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));
    await screen.findByRole('region', { name: 'Inspect workspace record' });
    expect(screen.queryByRole('button', { name: 'Save correction' })).not.toBeInTheDocument();
  });
  it('requires exact destructive confirmation before a single in-flight delete', async () => {
    const fetcher = mockApi('repair'); await open('repair');
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently…' }));
    const remove = await screen.findByRole('button', { name: 'Permanently delete clothing' });
    expect(remove).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type the clothing name'), { target: { value: 'Wrong encoding' } });
    fireEvent.change(screen.getByLabelText('Type the clothing code'), { target: { value: 'LOCAL-ITEM' } });
    fireEvent.change(screen.getByLabelText('Deletion reason'), { target: { value: 'Remove synthetic test mistake' } });
    expect(remove).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', {name:/I understand/}));
    fireEvent.click(remove); fireEvent.click(remove);
    await screen.findByText(/Clothing LOCAL-ITEM permanently deleted/);
    const deletes = fetcher.mock.calls.filter(([path]) => String(path).endsWith('/delete'));
    expect(deletes).toHaveLength(1);
    expect(new Headers(deletes[0]?.[1]?.headers).get('Idempotency-Key')).toBeTruthy();
    expect(JSON.parse(String(deletes[0]?.[1]?.body))).toMatchObject({ confirm_id: item, confirm_name: 'Wrong encoding', acknowledge: 'PERMANENTLY DELETE' });
  });
  it('shows blockers and cannot submit a delete when reservation history references the garment', async () => {
    mockApi('repair', true); await open('repair'); fireEvent.click(screen.getByRole('button', { name: 'Delete permanently…' }));
    expect(await screen.findByText('reservation lines: 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Permanently delete clothing' })).not.toBeInTheDocument();
  });
  it('sends corrections once and keeps the record fingerprint and reason', async () => {
    const fetcher = mockApi('repair'); await open('repair'); fireEvent.click(screen.getByRole('button', { name: 'Inspect / correct' }));
    const field = await screen.findByLabelText('name'); fireEvent.change(field, { target: { value: 'Correct encoding' } });
    fireEvent.change(screen.getByLabelText('Correction reason'), { target: { value: 'Fix synthetic name' } });
    const save = screen.getByRole('button', { name: 'Save correction' }); fireEvent.click(save); fireEvent.click(save);
    await screen.findByText(/Correction saved/);
    const writes = fetcher.mock.calls.filter(([path]) => String(path).endsWith('/correct'));
    expect(writes).toHaveLength(1); expect(JSON.parse(String(writes[0]?.[1]?.body))).toMatchObject({ fingerprint: 'a'.repeat(64), changes: { name: 'Correct encoding' }, reason: 'Fix synthetic name' });
  });
  it('closes and revokes support access and clears the workspace records', async () => {
    const fetcher = mockApi('read'); await open('read'); fireEvent.click(screen.getByRole('button', { name: 'Close workspace access' }));
    await screen.findByText('Workspace access closed and revoked.');
    expect(screen.queryByText('Wrong encoding')).not.toBeInTheDocument();
    await waitFor(() => expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith('/close'))).toHaveLength(1));
  });
  it('resumes the selected access after a support-history link without creating another grant', async () => {
    const fetcher=mockApi('read');render(<WorkspacePanel tenantId={tenant} businessName="Local test workspace" token={token} initialGrantId={grant}/>);
    await screen.findByText('Wrong encoding');expect(screen.queryByRole('button',{name:'Open workspace'})).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([url,options])=>String(url).endsWith(`/workspace/${grant}`)&&options?.method!=='POST')).toBe(true);
    expect(fetcher.mock.calls.some(([,options])=>options?.method==='POST')).toBe(false);
  });
  it('shows revoked access as an error and allows a fresh access request', async () => {
    mockApi('read');vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({success:false,error:{code:'FORBIDDEN',message:'This support access has ended.'},request_id:'ended-access'}),{status:403})));
    render(<WorkspacePanel tenantId={tenant} businessName="Local test workspace" token={token} initialGrantId={grant}/>);
    await screen.findByText(/This support access has ended/);expect(screen.getByRole('button',{name:'Open workspace'})).toBeDisabled();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

});
