INSERT INTO tenant(id,clerk_org_id,name,slug) VALUES
 ('11111111-1111-4111-8111-111111111111','org_local_luna','Local Luna Gowns','local-luna'),
 ('22222222-2222-4222-8222-222222222222','org_local_barong','Local Barong House','local-barong') ON CONFLICT DO NOTHING;
INSERT INTO subscription(tenant_id,plan_id,status,trial_ends_at,current_period_start,current_period_end)
 SELECT t.id,p.id,'trialing',now()+interval '7 days',now(),now()+interval '7 days' FROM tenant t CROSS JOIN plan p
 WHERE t.slug IN ('local-luna','local-barong') AND p.code='starter' AND p.version=1 ON CONFLICT DO NOTHING;
INSERT INTO membership(id,tenant_id,clerk_user_id,role) VALUES
 ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','user_local_owner','owner'),
 ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','user_local_frontdesk','frontdesk') ON CONFLICT DO NOTHING;
INSERT INTO audit_event(id,tenant_id,actor_kind,actor_key,action,entity_type,entity_id,outcome,redacted_summary,request_id,occurred_at) VALUES
 ('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111','staff','membership:44444444-4444-4444-8444-444444444444','catalogue.product.created','product',NULL,'succeeded','{"private":"merchant-only"}','local-staff-event',now()),
 ('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111','operator','operator:user_local_founder','operator.tenant.created','tenant','11111111-1111-4111-8111-111111111111','succeeded','{"private":"must-not-leak"}','local-operator-event',now()-interval '1 minute') ON CONFLICT DO NOTHING;
INSERT INTO outbox_event(id,tenant_id,dedupe_key,event_type,payload,status,attempts,max_attempts,available_at,safe_last_error) VALUES
 ('77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111','local-dead-job','subscription.payment_reviewed','{}','dead',8,8,now()-interval '1 hour','local synthetic failure') ON CONFLICT DO NOTHING;

-- Two billing examples: a verified local payment and one awaiting operator review.
INSERT INTO membership(id,tenant_id,clerk_user_id,role) VALUES
 ('88888888-8888-4888-8888-888888888888','22222222-2222-4222-8222-222222222222','user_local_barong_owner','owner') ON CONFLICT DO NOTHING;
INSERT INTO platform_payment_method(id,label,account_name,account_number,instructions)
 VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Local demonstration bank','Synthetic local account','LOCAL-TEST-ACCOUNT','Local fixtures only. This is not a real payment destination.') ON CONFLICT DO NOTHING;
UPDATE subscription SET status='active',current_period_start=now()-interval '1 day',current_period_end=now()+interval '1 month'
 WHERE tenant_id='22222222-2222-4222-8222-222222222222'
 AND NOT EXISTS(SELECT 1 FROM subscription_payment WHERE id='99999999-9999-4999-8999-999999999999');
INSERT INTO subscription_payment(id,tenant_id,subscription_id,amount_minor,currency,status,collection_method,business_key,payment_method_id,submitted_by_membership_id,reference,reviewed_at,reviewed_by)
 SELECT '99999999-9999-4999-8999-999999999999',s.tenant_id,s.id,p.monthly_minor,p.currency,'verified','manual_qr','local-seed-verified','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','88888888-8888-4888-8888-888888888888','LOCAL-DEMO-VERIFIED',now(),'user_local_ryanny'
 FROM subscription s JOIN plan p ON p.id=s.plan_id WHERE s.tenant_id='22222222-2222-4222-8222-222222222222' ON CONFLICT DO NOTHING;
INSERT INTO subscription_payment(id,tenant_id,subscription_id,amount_minor,currency,status,collection_method,business_key,payment_method_id,submitted_by_membership_id,reference)
 SELECT 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',s.tenant_id,s.id,p.monthly_minor,p.currency,'pending','manual_qr','local-seed-pending','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','LOCAL-DEMO-PENDING'
 FROM subscription s JOIN plan p ON p.id=s.plan_id WHERE s.tenant_id='11111111-1111-4111-8111-111111111111' ON CONFLICT DO NOTHING;
INSERT INTO audit_event(id,tenant_id,actor_kind,actor_key,action,entity_type,entity_id,outcome,redacted_summary,request_id,occurred_at)
 SELECT 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',sp.tenant_id,'operator','operator:user_local_ryanny','operator.subscription.payment.approve','subscription_payment',sp.id,'succeeded',
 jsonb_build_object('amount_minor',sp.amount_minor::text,'currency',sp.currency,'payer_key','membership:' || sp.submitted_by_membership_id::text,'paid_at',sp.reviewed_at,'current_period_end',s.current_period_end),'local-billing-example',sp.reviewed_at
 FROM subscription_payment sp JOIN subscription s ON s.id=sp.subscription_id WHERE sp.id='99999999-9999-4999-8999-999999999999' ON CONFLICT DO NOTHING;


-- Synthetic support examples only. No live tenant IDs or storage provider is involved.
INSERT INTO branch(id,tenant_id,name,code,timezone)
VALUES('dddddddd-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Local demonstration branch','LOCAL-SUPPORT','Asia/Manila')
ON CONFLICT(id) DO NOTHING;
INSERT INTO product(id,tenant_id,name,code,status)
VALUES('dddddddd-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','Local wrong encoding sample','LOCAL-SUPPORT-DEMO','active'),
('eeeeeeee-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','Local Barong sample','LOCAL-BARONG-DEMO','active')
ON CONFLICT(id) DO NOTHING;
INSERT INTO product_variant(id,tenant_id,product_id,sku,size_label,rental_price_minor,included_duration_minutes)
VALUES('dddddddd-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','dddddddd-0000-4000-8000-000000000002','LOCAL-SUPPORT-M','M',10000,1440)
ON CONFLICT(id) DO NOTHING;
INSERT INTO physical_asset(id,tenant_id,branch_id,variant_id,asset_code)
VALUES('dddddddd-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','dddddddd-0000-4000-8000-000000000001','dddddddd-0000-4000-8000-000000000003','LOCAL-SUPPORT-001')
ON CONFLICT(id) DO NOTHING;


-- Perpetual Free example: no billing end date, no paid-period controls.
INSERT INTO tenant(id,clerk_org_id,name,slug)
VALUES('ffffffff-1111-4fff-8fff-fffffffffff1','org_local_free','Local Free Studio','local-free') ON CONFLICT DO NOTHING;
INSERT INTO subscription(tenant_id,plan_id,status,current_period_start,current_period_end)
SELECT 'ffffffff-1111-4fff-8fff-fffffffffff1',id,'active',now(),NULL FROM plan WHERE code='free' AND version=1 ON CONFLICT DO NOTHING;
INSERT INTO membership(id,tenant_id,clerk_user_id,role)
VALUES('ffffffff-1111-4fff-8fff-fffffffffff2','ffffffff-1111-4fff-8fff-fffffffffff1','user_local_free_owner','owner') ON CONFLICT DO NOTHING;
