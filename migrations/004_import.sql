CREATE FUNCTION import_source(b uuid,p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE imp uuid; x jsonb; r jsonb; s uuid; pr uuid; sheet_name text; BEGIN
 PERFORM 1 FROM businesses WHERE id=b FOR UPDATE;
 IF EXISTS(SELECT 1 FROM source_imports WHERE business_id=b AND source_hash=p->>'hash') THEN RETURN jsonb_build_object('alreadyImported',true);END IF;
 INSERT INTO source_imports(business_id,source_id,source_hash,source_title,report) VALUES(b,COALESCE(p->>'sourceId','local-import'),p->>'hash','Sumber Jago · Snapshot 8 November 2026',p->'report') RETURNING id INTO imp;
 FOR sheet_name IN SELECT unnest(ARRAY['master','log','invoices']) LOOP
  FOR x IN SELECT value FROM jsonb_array_elements(p->sheet_name) LOOP
   r:=x->'data';
   INSERT INTO source_records(business_id,import_id,sheet,row_number,data) VALUES(b,imp,CASE sheet_name WHEN 'master' THEN 'Stock Opname & Mutasi' WHEN 'log' THEN 'Log Transaksi & Mutasi' ELSE 'Rekap Nota Supplier' END,(x->>'row')::integer,r);
   IF sheet_name='master' THEN
    INSERT INTO suppliers(business_id,name) VALUES(b,r->>3) ON CONFLICT(business_id,name) DO UPDATE SET name=excluded.name RETURNING id INTO s;
    INSERT INTO product_units(code,label) VALUES(r->>4,r->>4) ON CONFLICT DO NOTHING;
    INSERT INTO products(business_id,sku,name,base_unit,purchase_cost) VALUES(b,r->>1,r->>2,r->>4,(r->>11)::numeric) ON CONFLICT(business_id,sku) DO UPDATE SET sku=excluded.sku RETURNING id INTO pr;
    INSERT INTO product_supplier_mappings(business_id,product_id,supplier_id,supplier_code) VALUES(b,pr,s,r->>1) ON CONFLICT DO NOTHING;
   ELSIF sheet_name='log' THEN
    INSERT INTO suppliers(business_id,name) VALUES(b,r->>3) ON CONFLICT(business_id,name) DO UPDATE SET name=excluded.name RETURNING id INTO s;
    INSERT INTO product_units(code,label) VALUES(r->>9,r->>9) ON CONFLICT DO NOTHING;
    INSERT INTO products(business_id,sku,name,base_unit,purchase_cost) VALUES(b,r->>5,r->>6,r->>9,CASE WHEN (r->>7)::numeric>0 THEN round((r->>12)::numeric/(r->>7)::numeric,2) ELSE 0 END) ON CONFLICT(business_id,sku) DO UPDATE SET sku=excluded.sku RETURNING id INTO pr;
    INSERT INTO product_supplier_mappings(business_id,product_id,supplier_id,supplier_code) VALUES(b,pr,s,r->>5) ON CONFLICT DO NOTHING;
   ELSE
    INSERT INTO suppliers(business_id,name,payment_days) VALUES(b,r->>3,COALESCE((regexp_match(r->>5,'(\d+)\s*[Hh]ari'))[1]::integer,0)) ON CONFLICT(business_id,name) DO NOTHING;
   END IF;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('id',imp,'report',p->'report');END $$;
