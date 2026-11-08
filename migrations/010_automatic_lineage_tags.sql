CREATE FUNCTION tag_operation_lineage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO tags(business_id,entity_type,entity_id,tag,source,rule_version,evidence)
 VALUES(NEW.business_id,'operation',NEW.id::text,'TRANSAKSI_'||NEW.type,'rule','2026.11.08-v1',jsonb_build_object('operationId',NEW.id,'reference',NEW.reference,'type',NEW.type,'locationId',NEW.location_id,'recordedAt',NEW.created_at)) ON CONFLICT DO NOTHING;
 RETURN NEW;END $$;
CREATE TRIGGER operation_lineage_tag AFTER INSERT ON operations FOR EACH ROW EXECUTE FUNCTION tag_operation_lineage();
CREATE FUNCTION tag_source_lineage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO tags(business_id,entity_type,entity_id,tag,source,rule_version,evidence)
 VALUES(NEW.business_id,'source_record',NEW.id::text,'HISTORI_BELUM_DIVERIFIKASI','rule','2026.11.08-v1',jsonb_build_object('sourceRecordId',NEW.id,'sheet',NEW.sheet,'row',NEW.row_number,'status',NEW.status)) ON CONFLICT DO NOTHING;
 RETURN NEW;END $$;
CREATE TRIGGER source_lineage_tag AFTER INSERT ON source_records FOR EACH ROW EXECUTE FUNCTION tag_source_lineage();
