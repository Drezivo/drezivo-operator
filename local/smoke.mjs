import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
const secrets=JSON.parse(await readFile('/run/secrets/credentials','utf8'));
const db=new pg.Client({host:'db',database:'operator_local',user:'postgres',password:secrets.databasePassword});await db.connect();
const base='http://127.0.0.1:5080';let token;let checks=0;
async function call(path,body,key=randomUUID(),auth=token){
 const options={method:body===undefined?'GET':'POST',headers:{...(auth?{Authorization:`Bearer ${auth}`} :{}),...(body!==undefined?{'Content-Type':'application/json','Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)};
 for(let attempt=0;attempt<2;attempt++){
  const r=await fetch(base+path,options),data=await r.json();
  if(r.status===429&&attempt===0){const seconds=Number(r.headers.get('Retry-After'));if(Number.isInteger(seconds)&&seconds>0&&seconds<=60){console.log(`Respecting local rate limit; retrying the same intent after ${seconds}s.`);await new Promise(resolve=>setTimeout(resolve,seconds*1000));continue;}}
  return {status:r.status,...data};
 }
}
async function count(sql,params=[]){return Number((await db.query(sql,params)).rows[0].n);}
try{
 assert.equal((await call('/api/v1/overview',undefined,undefined,null)).status,401);checks++;
 const login=await call('/local/login',{profile:'user_local_founder'});assert.equal(login.status,200);token=login.data.token;const subject=login.data.profile.id;const sh=createHash('sha256').update('operator-session:').update(login.data.session_id).digest('hex');const sessionEntity=`${sh.slice(0,8)}-${sh.slice(8,12)}-4${sh.slice(13,16)}-a${sh.slice(17,20)}-${sh.slice(20,32)}`;
 for(const path of ['/api/v1/overview','/api/v1/analytics?months=12','/api/v1/tenants','/api/v1/people','/api/v1/businesses','/api/v1/subscriptions','/api/v1/businesses/11111111-1111-4111-8111-111111111111','/api/v1/businesses/11111111-1111-4111-8111-111111111111/entitlements','/api/v1/operators','/api/v1/support-grants','/api/v1/audit-events','/api/v1/jobs','/api/v1/notifications','/api/v1/subscription-payments','/api/v1/platform-payment-methods']){
  const r=await call(path);assert.equal(r.status,200,`${path}: ${r.error?.code}`);checks++;
 }
 const ledger=await call('/api/v1/subscriptions');assert(ledger.data.items.some(s=>s.reviewed_by==='user_local_ryanny'&&s.paid_at&&s.payer_key));checks++;
 const detail=await call('/api/v1/tenants/11111111-1111-4111-8111-111111111111');assert.deepEqual(detail.data.recent_audit,[]);
 const audit=await call('/api/v1/audit-events');assert(!JSON.stringify(audit).includes('merchant-only'));assert(!JSON.stringify(audit).includes('must-not-leak'));
 const staff=await call('/api/v1/audit-events?actor_kind=staff');assert(!staff.data.items.some(e=>e.action.startsWith('catalogue.')));
 assert.equal(await count("SELECT count(*) AS n FROM audit_event WHERE request_id='local-staff-event'"),1);checks++;
 const startKey=randomUUID();const started=()=>call('/api/v1/session/events',{event:'started'},startKey);
 await started();await started();await Promise.all([started(),started()]);
 assert.equal(await count("SELECT count(*) AS n FROM global_audit_event WHERE actor_key=$1 AND entity_id=$2 AND action='operator.session.started' AND entity_type='operator_session'",[`operator:${subject}`,sessionEntity]),1);checks++;
 const t='11111111-1111-4111-8111-111111111111',lockKey=randomUUID();
 await db.query("UPDATE tenant SET status='active' WHERE id=$1",[t]);
 const lock=()=>call(`/api/v1/tenants/${t}/lock`,{reason:'Local concurrency check'},lockKey);
 const first=await lock(),second=await lock();assert.equal(first.status,200);assert.equal(second.data.replayed,true);
 const bad=await call(`/api/v1/tenants/${t}/lock`,{reason:'Changed request body'},lockKey);assert.equal(bad.status,409);checks++;
 const unlockKey=randomUUID();const unlocked=await Promise.all([call(`/api/v1/tenants/${t}/unlock`,{reason:'Local concurrent unlock'},unlockKey),call(`/api/v1/tenants/${t}/unlock`,{reason:'Local concurrent unlock'},unlockKey)]);assert.equal(unlocked.filter(r=>r.data?.changed).length,1);checks++;
 const grantBody={tenant_id:t,permission_codes:['business.summary.read'],reason:'Local support investigation',starts_at:new Date(Date.now()-60000).toISOString(),expires_at:new Date(Date.now()+3600000).toISOString()};
 const grantKey=randomUUID(),create=()=>call('/api/v1/support-grants',grantBody,grantKey);
 const granted=await create();assert.equal(granted.status,201);assert.equal((await create()).data.grant_id,granted.data.grant_id);const duplicates=await Promise.all([create(),create()]);assert(duplicates.every(r=>r.data.grant_id===granted.data.grant_id));checks++;
 const conflict=await call('/api/v1/support-grants',{...grantBody,reason:'Other intent'},grantKey);assert.equal(conflict.status,409);
 const revokeKey=randomUUID(),revoke=()=>call(`/api/v1/support-grants/${granted.data.grant_id}/revoke`,{},revokeKey);
 assert.equal((await revoke()).status,200);await revoke();await Promise.all([revoke(),revoke()]);assert.equal(await count("SELECT count(*) AS n FROM audit_event WHERE entity_id=$1 AND action='operator.support.grant.revoked'",[granted.data.grant_id]),1);checks++;
 const job=randomUUID();await db.query("INSERT INTO outbox_event(id,tenant_id,dedupe_key,event_type,payload,status,attempts,max_attempts,available_at) VALUES($1,$2,$3,'local.check','{}','dead',8,8,now())",[job,t,job]);
 const retryKey=randomUUID(),retry=()=>call(`/api/v1/jobs/${job}/retry`,{reason:'Local retry check'},retryKey);
 assert.equal((await retry()).status,202);await retry();await Promise.all([retry(),retry()]);assert.equal(await count("SELECT count(*) AS n FROM audit_event WHERE entity_id=$1 AND action='operator.job.retry'",[job]),1);checks++;
 assert.equal((await call('/api/v1/audit-events?actor_kind=unknown')).status,400);
 const page=await call('/api/v1/audit-events?limit=1');assert(page.data.next_cursor);const next=await call(`/api/v1/audit-events?limit=1&cursor=${page.data.next_cursor}`);assert.notEqual(next.data.items[0].event_id,page.data.items[0].event_id);
 assert.equal((await call(`/api/v1/audit-events?actor_kind=system&cursor=${page.data.next_cursor}`)).status,400);checks++;
 assert.equal((await call('/local/login',{profile:'user_local_read_only_operator'})).status,400);checks++;
 const free=await call('/api/v1/tenants/ffffffff-1111-4fff-8fff-fffffffffff1');assert.equal(free.status,200);assert.equal(free.data.subscription.plan_code,'free');assert.equal(free.data.subscription.current_period_end,null);checks++;
 const workspaceKey=randomUUID(),workspaceBody={mode:'read',minutes:15,reason:'Local HTTP workspace regression'};
 const workspace=await call(`/api/v1/tenants/${t}/workspace`,workspaceBody,workspaceKey);assert.equal(workspace.status,201);
 const grantId=workspace.data.grant_id,workspacePath=`/api/v1/tenants/${t}/workspace/${grantId}`;
 assert.equal((await call(`/api/v1/tenants/${t}/workspace`,workspaceBody,workspaceKey)).data.grant_id,grantId);
 assert((await Promise.all([call(`/api/v1/tenants/${t}/workspace`,workspaceBody,workspaceKey),call(`/api/v1/tenants/${t}/workspace`,workspaceBody,workspaceKey)])).every(r=>r.data.grant_id===grantId));checks++;
 const resumed=await call(workspacePath);assert.equal(resumed.status,200);assert.equal(resumed.data.operator_subject,subject);assert.equal(resumed.data.mode,'read');checks++;
 const clothing=await call(`${workspacePath}/records/clothing`);assert.equal(clothing.status,200);assert(clothing.data.items.length);checks++;
 const item=clothing.data.items[0],record=await call(`${workspacePath}/records/clothing/${item.id}`);assert.equal(record.status,200);
 assert.equal((await call(`${workspacePath}/records/clothing/${item.id}/correct`,{fingerprint:record.data.fingerprint,changes:{name:'Must not be applied'},reason:'Read-only denial check'})).status,403);
 assert.equal((await call(`${workspacePath}/records/clothing/${item.id}`)).data.data.name,item.name);checks++;
 const closeKey=randomUUID(),close=()=>call(`${workspacePath}/close`,{},closeKey);assert.equal((await close()).status,200);assert.equal((await close()).status,200);assert((await Promise.all([close(),close()])).every(r=>r.status===200));assert.equal((await call(workspacePath)).status,403);checks++;
 const repair=await call(`/api/v1/tenants/${t}/workspace`,{...workspaceBody,mode:'repair'});assert.equal(repair.status,201);const repairPath=`/api/v1/tenants/${t}/workspace/${repair.data.grant_id}`;
 const deletionPreview=await call(`${repairPath}/clothing/${item.id}/delete-preview`);assert.equal(deletionPreview.status,200);assert.equal(deletionPreview.data.id,item.id);assert.equal(typeof deletionPreview.data.can_delete,'boolean');assert.equal((await call(`${repairPath}/close`,{})).status,200);checks++;
 const endKey=randomUUID(),end=()=>call('/api/v1/session/events',{event:'ended'},endKey);await end();await end();await Promise.all([end(),end()]);assert.equal(await count("SELECT count(*) AS n FROM global_audit_event WHERE actor_key=$1 AND entity_id=$2 AND action='operator.session.ended'",[`operator:${subject}`,sessionEntity]),1);assert.equal((await call('/api/v1/overview')).status,401);checks++;
 console.log(`PASS: ${checks} local API/DB checks, including all console reads, staff-history exclusion, filter-bound pagination and sequential/concurrent mutations.`);
}finally{await db.end();}
