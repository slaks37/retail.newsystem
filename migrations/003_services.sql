CREATE FUNCTION refresh_rule_tags(b uuid,actor uuid,version text,insights jsonb) RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE run uuid; BEGIN
 PERFORM 1 FROM businesses WHERE id=b FOR UPDATE;
 DELETE FROM tags WHERE business_id=b AND source='rule';
 INSERT INTO insight_runs(business_id,rule_version,insights,created_by) VALUES(b,version,insights,actor) RETURNING id INTO run;
 INSERT INTO tags(business_id,entity_type,entity_id,tag,source,rule_version,evidence)
 SELECT b,x->>'entityType',x->>'entityId',x->>'tag','rule',version,x->'evidence' FROM jsonb_array_elements(insights) x;
 RETURN run;END $$;
CREATE FUNCTION approve_invoice(b uuid,actor uuid,inv uuid,note text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF length(note)<10 OR NOT EXISTS(SELECT 1 FROM business_memberships WHERE business_id=b AND user_id=actor AND role IN ('owner','manager')) THEN RAISE EXCEPTION 'Akses atau catatan persetujuan tidak valid'; END IF;
 UPDATE supplier_invoices SET status=CASE WHEN total=paid_amount THEN 'paid' ELSE 'approved' END WHERE business_id=b AND id=inv AND status='blocked';
 IF NOT FOUND THEN RAISE EXCEPTION 'Nota yang diblokir tidak ditemukan'; END IF;
 INSERT INTO audit_logs(business_id,actor_id,action,entity_type,entity_id,data) VALUES(b,actor,'APPROVE_MISMATCH','invoice',inv::text,jsonb_build_object('reason',note));
 END $$;
