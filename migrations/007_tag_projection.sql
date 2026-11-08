CREATE OR REPLACE FUNCTION refresh_rule_tags(b uuid,actor uuid,version text,insights jsonb) RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE run uuid; BEGIN
 PERFORM 1 FROM businesses WHERE id=b FOR UPDATE;
 DELETE FROM tags WHERE business_id=b AND source='rule';
 INSERT INTO insight_runs(business_id,rule_version,insights,created_by) VALUES(b,version,insights,actor) RETURNING id INTO run;
 INSERT INTO tags(business_id,entity_type,entity_id,tag,source,rule_version,evidence)
 SELECT b,x->>'entityType',x->>'entityId',x->>'tag','rule',version,x->'evidence' FROM jsonb_array_elements(insights) x;
 -- Every persisted operational transaction and legacy source row receives a factual lineage tag.
 INSERT INTO tags(business_id,entity_type,entity_id,tag,source,rule_version,evidence)
 SELECT b,'operation',id::text,'TRANSAKSI_'||type,'rule',version,jsonb_build_object('reference',reference,'type',type,'locationId',location_id,'recordedAt',created_at,'operationId',id) FROM operations WHERE business_id=b;
 INSERT INTO tags(business_id,entity_type,entity_id,tag,source,rule_version,evidence)
 SELECT b,'source_record',id::text,'HISTORI_BELUM_DIVERIFIKASI','rule',version,jsonb_build_object('sheet',sheet,'row',row_number,'status',status,'sourceRecordId',id) FROM source_records WHERE business_id=b;
 RETURN run;END $$;
