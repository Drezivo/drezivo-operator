import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditPanel } from './AuditPanel';
import { clearViewCache } from '@/lib/view-cache';
const getToken = async () => 'local-test-session';
const tenant='11111111-1111-4111-8111-111111111111';
const event = { event_id:tenant,tenant_id:null,business_name:null,occurred_at:'2026-10-01T00:00:00Z',actor_kind:'operator',actor_key:'operator:user_ryanny',action:'operator.session.started',entity_type:'operator_session',entity_id:null,outcome:'succeeded',request_id:'req-audit' };
const response=(data:unknown)=>new Response(JSON.stringify({success:true,data,request_id:'req-audit'}),{status:200});
function mockApi(items:unknown[]=[event]) {
  const fetcher=vi.fn<typeof fetch>(async url=>String(url).includes('/audit-events?')?response({items,next_cursor:null}):String(url).includes('/operators?')?response({items:[{operator_id:'user_ryanny',display_name:'Ryanny'}]}):response({items:[{tenant_id:tenant,name:'Local Luna',slug:'local-luna'}]}));
  vi.stubGlobal('fetch',fetcher);return fetcher;
}
beforeEach(()=>{clearViewCache();vi.stubEnv('NEXT_PUBLIC_DREZIVO_API_BASE_URL','http://localhost:5080/api/v1');});
afterEach(()=>{cleanup();clearViewCache();vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('readable system audit filters',()=>{
  it('shows attributable events with readable action and operator names',async()=>{
    mockApi();render(<AuditPanel getToken={getToken}/>);
    const table=await screen.findByRole('table');await waitFor(()=>expect(within(table).getByText('Ryanny')).toBeInTheDocument());
    expect(within(table).getByText('Signed in')).toBeInTheDocument();expect(screen.queryByText('Recent activity')).not.toBeInTheDocument();
  });
  it('filters by selected business, operator and action without requiring IDs',async()=>{
    const fetcher=mockApi();render(<AuditPanel getToken={getToken}/>);await screen.findByRole('option',{name:/Local Luna/});await screen.findByRole('option',{name:'Ryanny'});
    fireEvent.change(screen.getByRole('combobox',{name:'Business'}),{target:{value:tenant}});
    fireEvent.change(screen.getByRole('combobox',{name:'Operator'}),{target:{value:'operator:user_ryanny'}});
    fireEvent.change(screen.getByRole('combobox',{name:'Action'}),{target:{value:'operator.session.started'}});
    fireEvent.click(screen.getByRole('button',{name:'Apply filters'}));
    await waitFor(()=>expect(fetcher.mock.calls.some(([url])=>String(url).includes(`tenant_id=${tenant}`)&&String(url).includes('actor_key=operator%3Auser_ryanny')&&String(url).includes('action=operator.session.started'))).toBe(true));
  });
  it('retains exact-ID filtering as an optional advanced tool',async()=>{
    const fetcher=mockApi();render(<AuditPanel getToken={getToken}/>);await screen.findByRole('table');
    fireEvent.click(screen.getByText('Advanced: exact actor or action ID'));
    fireEvent.change(screen.getByLabelText('Operator or payer ID'),{target:{value:'operator:user_founder'}});fireEvent.click(screen.getByRole('button',{name:'Apply filters'}));
    await waitFor(()=>expect(fetcher.mock.calls.some(([url])=>String(url).includes('actor_key=operator%3Auser_founder'))).toBe(true));
  });
  it('rejects an inverted date range before requesting a filtered page',async()=>{
    const fetcher=mockApi();render(<AuditPanel getToken={getToken}/>);await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('From (Manila)'),{target:{value:'2026-10-15T12:00'}});fireEvent.change(screen.getByLabelText('Before (Manila)'),{target:{value:'2026-10-14T12:00'}});fireEvent.click(screen.getByRole('button',{name:'Apply filters'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('The end of the date range must be after the start.');expect(fetcher.mock.calls.filter(([url])=>String(url).includes('/audit-events?'))).toHaveLength(1);
  });
  it('requests only operator events in the operator activity view',async()=>{
    const fetcher=mockApi([]);render(<AuditPanel getToken={getToken} operatorOnly/>);await screen.findByText('No platform events');expect(fetcher.mock.calls.some(([url])=>String(url).includes('actor_kind=operator'))).toBe(true);
  });
});
