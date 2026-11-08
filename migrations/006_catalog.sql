ALTER TABLE products ADD COLUMN pieces_per_base numeric(20,6) CHECK(pieces_per_base>0);
CREATE FUNCTION import_catalog(b uuid,actor uuid,items jsonb) RETURNS integer LANGUAGE plpgsql AS $$ DECLARE x jsonb;p products;n integer:=0;BEGIN
 PERFORM 1 FROM businesses WHERE id=b FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM business_memberships WHERE business_id=b AND user_id=actor AND role IN ('owner','manager')) THEN RAISE EXCEPTION 'Akses katalog ditolak'; END IF;
 IF jsonb_array_length(items) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Jumlah produk tidak valid'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(items) LOOP
  SELECT * INTO p FROM products WHERE business_id=b AND sku=x->>'sku';
  IF FOUND AND p.base_unit<>x->>'base_unit' THEN RAISE EXCEPTION 'Satuan dasar tidak boleh berubah untuk SKU %',p.sku; END IF;
  INSERT INTO products(business_id,sku,name,barcode,base_unit,purchase_cost,selling_price,min_stock,active,pieces_per_base)
  VALUES(b,x->>'sku',x->>'name',NULLIF(x->>'barcode',''),x->>'base_unit',(x->>'purchase_cost')::numeric,(x->>'selling_price')::numeric,(x->>'min_stock')::numeric,(x->>'active')::boolean,(x->>'pieces_per_base')::numeric)
  ON CONFLICT(business_id,sku) DO UPDATE SET name=excluded.name,barcode=excluded.barcode,purchase_cost=excluded.purchase_cost,selling_price=excluded.selling_price,min_stock=excluded.min_stock,active=excluded.active,pieces_per_base=COALESCE(excluded.pieces_per_base,products.pieces_per_base)
  RETURNING * INTO p;
  INSERT INTO audit_logs(business_id,actor_id,action,entity_type,entity_id,data) VALUES(b,actor,'IMPORT_CATALOG','product',p.id::text,x);n:=n+1;
 END LOOP;RETURN n;END $$;
