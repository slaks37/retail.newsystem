CREATE FUNCTION post_operation(b uuid, actor uuid, body jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
<<posting>>
DECLARE
 op uuid; prev operations; kind text:=body->>'type'; loc uuid:=(body->>'location_id')::uuid;
 ln jsonb; prod products; bal inventory_balances; perm text; role_actions text[];
 qty numeric; received numeric; damaged numeric; mult numeric; signed_qty numeric; price numeric; cost numeric; disc numeric; tax numeric; line_total numeric;
 subtotal numeric:=0; total numeric:=0; cost_total numeric:=0; inv_total numeric:=0;
 receipt uuid; inv uuid; sale uuid; supp uuid; ord uuid; pol purchase_order_lines;
 v_header_discount numeric:=COALESCE((body->>'discount')::numeric,0);v_header_tax numeric:=COALESCE((body->>'tax')::numeric,0);v_rounding numeric:=COALESCE((body->>'rounding')::numeric,0);v_base_total numeric;v_header_factor numeric:=1;
 v_warnings jsonb:='[]'; payload_fingerprint text:=md5(body::text); ref text:=body->>'reference'; original operations; original_qty numeric; returned_qty numeric; old_invoice supplier_invoices;
BEGIN
 -- Serialize operations for this business. This is intentionally simple for a single retail store.
 PERFORM 1 FROM businesses WHERE id=b FOR UPDATE;
 SELECT p.actions INTO role_actions FROM business_memberships m JOIN permissions p ON p.role=m.role JOIN users u ON u.id=m.user_id AND u.active WHERE m.business_id=b AND m.user_id=actor;
 perm:=CASE kind WHEN 'SALE' THEN 'sell' WHEN 'PAYMENT' THEN 'pay' WHEN 'PURCHASE_RECEIPT' THEN 'receive' ELSE 'adjust' END;
 IF role_actions IS NULL OR NOT perm=ANY(role_actions) THEN RAISE EXCEPTION 'Akses transaksi ditolak'; END IF;
 IF NOT EXISTS(SELECT 1 FROM locations WHERE id=loc AND business_id=b) THEN RAISE EXCEPTION 'Gudang tidak valid'; END IF;
 IF length(COALESCE(body->>'idempotency_key',''))<8 OR length(COALESCE(ref,''))<1 THEN RAISE EXCEPTION 'Kunci transaksi dan referensi wajib'; END IF;
 SELECT * INTO prev FROM operations WHERE business_id=b AND idempotency_key=body->>'idempotency_key';
 IF FOUND THEN
   IF prev.payload_hash<>payload_fingerprint THEN RAISE EXCEPTION 'Kunci transaksi sudah dipakai untuk data berbeda'; END IF;
   RETURN jsonb_build_object('id',prev.id,'replayed',true,'reference',prev.reference);
 END IF;
 IF kind NOT IN ('SALE','PURCHASE_RECEIPT','OPENING_BALANCE','STOCK_ADJUSTMENT','DAMAGE','CUSTOMER_RETURN','SUPPLIER_RETURN','TRANSFER','PAYMENT') THEN RAISE EXCEPTION 'Jenis transaksi tidak valid'; END IF;
 IF kind IN ('STOCK_ADJUSTMENT','DAMAGE','TRANSFER','CUSTOMER_RETURN','SUPPLIER_RETURN','OPENING_BALANCE') AND length(COALESCE(body->>'reason',''))<3 THEN RAISE EXCEPTION 'Alasan transaksi wajib'; END IF;
 INSERT INTO operations(business_id,location_id,type,idempotency_key,payload_hash,reference,payload,created_by)
 VALUES(b,loc,kind,body->>'idempotency_key',payload_fingerprint,ref,body,actor) RETURNING id INTO op;
 IF kind='PAYMENT' THEN
   SELECT * INTO old_invoice FROM supplier_invoices WHERE business_id=b AND id=(body->>'invoice_id')::uuid FOR UPDATE;
   IF NOT FOUND OR old_invoice.status<>'approved' THEN RAISE EXCEPTION 'Nota belum disetujui atau sudah lunas'; END IF;
   total:=(body->>'amount')::numeric;
   IF total IS NULL OR total<=0 OR total<>round(total,2) OR total>old_invoice.total-old_invoice.paid_amount THEN RAISE EXCEPTION 'Jumlah pembayaran tidak valid'; END IF;
   IF length(COALESCE(body->>'proof_reference',''))<3 THEN RAISE EXCEPTION 'Referensi bukti pembayaran wajib'; END IF;
   INSERT INTO supplier_payments(business_id,invoice_id,operation_id,amount,method,proof_reference,paid_at)
   VALUES(b,old_invoice.id,op,total,body->>'method',body->>'proof_reference',COALESCE((body->>'paid_at')::timestamptz,now()));
   UPDATE supplier_invoices SET paid_amount=paid_amount+posting.total,status=CASE WHEN paid_amount+posting.total=old_invoice.total THEN 'paid' ELSE 'approved' END WHERE id=old_invoice.id;
 ELSE
   IF jsonb_typeof(body->'lines')<>'array' OR jsonb_array_length(body->'lines') NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'Baris transaksi wajib (maksimal 300)'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(body->'lines') x GROUP BY x->>'product_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Gabungkan produk yang sama sebelum menyimpan'; END IF;
   IF kind='PURCHASE_RECEIPT' THEN
     SELECT COALESCE(sum((x->>'quantity')::numeric*(x->>'unit_price')::numeric-COALESCE((x->>'discount')::numeric,0)+COALESCE((x->>'tax')::numeric,0)),0) INTO v_base_total FROM jsonb_array_elements(body->'lines') x;
     IF v_header_discount<0 OR v_header_discount>v_base_total OR v_header_tax<0 OR abs(v_rounding)>100 OR v_header_discount<>round(v_header_discount,2) OR v_header_tax<>round(v_header_tax,2) OR v_rounding<>round(v_rounding,2) OR v_base_total-v_header_discount+v_header_tax+v_rounding<0 THEN RAISE EXCEPTION 'Diskon, pajak, atau pembulatan nota tidak valid'; END IF;
     IF v_base_total>0 THEN v_header_factor:=(v_base_total-v_header_discount+v_header_tax+v_rounding)/v_base_total;
     ELSIF v_header_tax<>0 OR v_rounding<>0 THEN RAISE EXCEPTION 'Biaya tambahan perlu baris barang bernilai positif'; END IF;
     supp:=(body->>'supplier_id')::uuid; ord:=NULLIF(body->>'order_id','')::uuid;
     IF NOT EXISTS(SELECT 1 FROM suppliers WHERE business_id=b AND id=supp AND active) OR NULLIF(body->>'invoice_number','') IS NULL OR NULLIF(body->>'invoice_date','') IS NULL THEN RAISE EXCEPTION 'Supplier, nomor dan tanggal nota wajib'; END IF;
     IF ord IS NOT NULL AND NOT EXISTS(SELECT 1 FROM purchase_orders WHERE business_id=b AND id=ord AND supplier_id=supp AND status IN ('open','partial')) THEN RAISE EXCEPTION 'PO tidak sesuai supplier atau sudah ditutup'; END IF;
     INSERT INTO goods_receipts(business_id,operation_id,supplier_id,order_id,invoice_date,delivery_date) VALUES(b,op,supp,ord,(body->>'invoice_date')::date,NULLIF(body->>'delivery_date','')::date) RETURNING id INTO receipt;
   END IF;
   IF kind IN ('CUSTOMER_RETURN','SUPPLIER_RETURN') THEN
     SELECT * INTO original FROM operations WHERE business_id=b AND id=(body->>'original_operation_id')::uuid;
     IF NOT FOUND OR original.type<>(CASE WHEN kind='CUSTOMER_RETURN' THEN 'SALE' ELSE 'PURCHASE_RECEIPT' END) THEN RAISE EXCEPTION 'Transaksi asal retur tidak valid'; END IF;
   END IF;
   FOR ln IN SELECT value FROM jsonb_array_elements(body->'lines') LOOP
     SELECT * INTO prod FROM products WHERE business_id=b AND id=(ln->>'product_id')::uuid AND active;
     IF NOT FOUND THEN RAISE EXCEPTION 'Produk tidak ditemukan'; END IF;
     IF kind='SALE' AND NOT prod.stock_verified THEN RAISE EXCEPTION 'Stok produk belum diverifikasi'; END IF;
     qty:=(ln->>'quantity')::numeric; price:=COALESCE((ln->>'unit_price')::numeric,prod.purchase_cost); disc:=COALESCE((ln->>'discount')::numeric,0); tax:=COALESCE((ln->>'tax')::numeric,0);
     IF qty IS NULL OR qty<=0 OR qty>100000000 OR qty<>round(qty,4) OR price<0 OR price>100000000000 OR price<>round(price,2) OR disc<0 OR tax<0 OR disc<>round(disc,2) OR tax<>round(tax,2) THEN RAISE EXCEPTION 'Angka transaksi tidak valid'; END IF;
     IF ln->>'unit'=prod.base_unit THEN mult:=1; ELSE SELECT multiplier INTO mult FROM product_unit_conversions WHERE business_id=b AND product_id=prod.id AND unit=ln->>'unit'; END IF;
     IF mult IS NULL OR mult<=0 THEN RAISE EXCEPTION 'Konversi satuan belum dikonfirmasi untuk %',prod.sku; END IF;
     IF kind IN ('SALE','CUSTOMER_RETURN','SUPPLIER_RETURN','DAMAGE','STOCK_ADJUSTMENT','OPENING_BALANCE','TRANSFER') AND mult<>1 THEN RAISE EXCEPTION 'Gunakan satuan dasar untuk transaksi ini'; END IF;
     IF kind='OPENING_BALANCE' AND EXISTS(SELECT 1 FROM inventory_movements WHERE business_id=b AND location_id=loc AND product_id=prod.id) THEN RAISE EXCEPTION 'Saldo awal produk sudah tercatat'; END IF;
     INSERT INTO inventory_balances(business_id,location_id,product_id) VALUES(b,loc,prod.id) ON CONFLICT DO NOTHING;
     SELECT * INTO bal FROM inventory_balances WHERE business_id=b AND location_id=loc AND product_id=prod.id FOR UPDATE;
     cost:=bal.average_cost; received:=qty; damaged:=0;
     line_total:=round(qty*price-disc+tax,2);
     IF disc>qty*price OR line_total<0 THEN RAISE EXCEPTION 'Diskon melebihi nilai barang'; END IF;
     IF kind='SALE' THEN
       IF ln->>'unit'<>prod.base_unit THEN RAISE EXCEPTION 'POS harus memakai satuan dasar'; END IF;
       IF ln->>'unit_price' IS NULL THEN RAISE EXCEPTION 'Harga jual wajib diisi'; END IF;
       IF disc<>0 OR tax<>0 THEN RAISE EXCEPTION 'Gunakan diskon tingkat transaksi di POS'; END IF;
       subtotal:=subtotal+line_total; cost_total:=cost_total+round(qty*cost,2); signed_qty:=-qty;
     ELSIF kind='PURCHASE_RECEIPT' THEN
       received:=(ln->>'received_quantity')::numeric; damaged:=COALESCE((ln->>'damaged_quantity')::numeric,0);
       IF received IS NULL OR received<0 OR received>100000000 OR damaged<0 OR damaged>received OR received<>round(received,4) OR damaged<>round(damaged,4) THEN RAISE EXCEPTION 'Jumlah fisik/rusak tidak valid'; END IF;
       IF ln->>'unit_price' IS NULL THEN RAISE EXCEPTION 'Harga nota wajib'; END IF;
       IF ln->>'printed_total' IS NOT NULL AND abs((ln->>'printed_total')::numeric-line_total)>0.01 THEN RAISE EXCEPTION 'Total baris nota tidak sesuai hitungan'; END IF;
       IF qty<>received OR damaged>0 THEN v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object('sku',prod.sku,'type','physical_mismatch','invoice',qty,'received',received,'damaged',damaged)); END IF;
       IF ord IS NOT NULL THEN
         SELECT * INTO pol FROM purchase_order_lines WHERE business_id=b AND order_id=ord AND product_id=prod.id FOR UPDATE;
         IF NOT FOUND THEN v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object('sku',prod.sku,'type','not_in_po'));
         ELSE
           IF pol.unit<>ln->>'unit' OR pol.unit_price<>price OR pol.received_quantity+received>pol.quantity THEN v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object('sku',prod.sku,'type','po_mismatch','ordered',pol.quantity,'received_before',pol.received_quantity,'ordered_price',pol.unit_price)); END IF;
           IF pol.unit=ln->>'unit' THEN UPDATE purchase_order_lines SET received_quantity=received_quantity+received WHERE id=pol.id; END IF;
         END IF;
       END IF;
       cost:=round(line_total*v_header_factor/qty/mult,2); signed_qty:=(received-damaged)*mult;
       IF price=0 THEN cost:=0; END IF;
       IF prod.purchase_cost>0 AND cost>prod.purchase_cost*1.1 THEN v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object('sku',prod.sku,'type','price_increase','old',prod.purchase_cost,'new',cost)); END IF;
       INSERT INTO goods_receipt_lines(receipt_id,product_id,invoice_quantity,received_quantity,damaged_quantity,unit,multiplier,unit_price,discount,tax) VALUES(receipt,prod.id,qty,received,damaged,ln->>'unit',mult,price,disc,tax);
       INSERT INTO supplier_price_history(business_id,product_id,supplier_id,unit_cost,reference) VALUES(b,prod.id,supp,cost,ref);
       inv_total:=inv_total+line_total;
     ELSIF kind IN ('CUSTOMER_RETURN','SUPPLIER_RETURN') THEN
       SELECT abs(sum(quantity)) INTO original_qty FROM inventory_movements WHERE operation_id=original.id AND product_id=prod.id;
       SELECT COALESCE(sum(abs(m.quantity)),0) INTO returned_qty FROM inventory_movements m JOIN operations o ON o.id=m.operation_id WHERE m.business_id=b AND m.product_id=prod.id AND o.type=kind AND o.payload->>'original_operation_id'=original.id::text;
       IF original_qty IS NULL OR qty+returned_qty>original_qty THEN RAISE EXCEPTION 'Jumlah retur melebihi transaksi asal'; END IF;
       IF original.location_id<>loc THEN RAISE EXCEPTION 'Gudang retur harus sama dengan transaksi asal'; END IF;
       signed_qty:=CASE WHEN kind='CUSTOMER_RETURN' THEN qty ELSE -qty END;
       IF kind='CUSTOMER_RETURN' THEN SELECT unit_cost INTO cost FROM inventory_movements WHERE operation_id=original.id AND product_id=prod.id LIMIT 1; END IF;
     ELSIF kind='DAMAGE' THEN signed_qty:=-qty;
     ELSIF kind='STOCK_ADJUSTMENT' THEN
       IF ln->>'counted_quantity' IS NOT NULL THEN
         IF (ln->>'counted_quantity')::numeric<0 OR (ln->>'counted_quantity')::numeric>100000000 OR (ln->>'counted_quantity')::numeric<>round((ln->>'counted_quantity')::numeric,4) THEN RAISE EXCEPTION 'Jumlah fisik opname tidak valid'; END IF;
         signed_qty:=(ln->>'counted_quantity')::numeric-bal.quantity;
       ELSE
       IF ln->>'direction' IS NULL OR ln->>'direction' NOT IN ('in','out') THEN RAISE EXCEPTION 'Arah penyesuaian wajib'; END IF;
       signed_qty:=CASE WHEN ln->>'direction'='out' THEN -qty ELSE qty END;
       END IF;
     ELSIF kind='TRANSFER' THEN
       IF NOT EXISTS(SELECT 1 FROM locations WHERE business_id=b AND id=(body->>'target_location_id')::uuid AND id<>loc) THEN RAISE EXCEPTION 'Gudang tujuan tidak valid'; END IF;
       signed_qty:=-qty;
     ELSE signed_qty:=qty;cost:=price;
     END IF;
     IF bal.quantity+signed_qty<0 THEN RAISE EXCEPTION 'Stok tidak cukup: % (tersedia %)',prod.sku,bal.quantity; END IF;
     IF signed_qty<>0 THEN
       UPDATE inventory_balances SET quantity=quantity+signed_qty,average_cost=CASE WHEN signed_qty>0 AND quantity+signed_qty>0 THEN round((quantity*average_cost+signed_qty*cost)/(quantity+signed_qty),2) ELSE average_cost END,updated_at=now() WHERE business_id=b AND location_id=loc AND product_id=prod.id;
       INSERT INTO inventory_movements(business_id,location_id,product_id,operation_id,type,quantity,unit_cost,reference) VALUES(b,loc,prod.id,op,CASE WHEN kind='TRANSFER' THEN 'TRANSFER_OUT' ELSE kind END,signed_qty,cost,ref);
     END IF;
     IF kind='TRANSFER' THEN
       INSERT INTO inventory_balances(business_id,location_id,product_id,quantity,average_cost) VALUES(b,(body->>'target_location_id')::uuid,prod.id,qty,cost) ON CONFLICT(business_id,location_id,product_id) DO UPDATE SET average_cost=round((inventory_balances.quantity*inventory_balances.average_cost+qty*cost)/(inventory_balances.quantity+qty),2),quantity=inventory_balances.quantity+qty,updated_at=now();
       INSERT INTO inventory_movements(business_id,location_id,product_id,operation_id,type,quantity,unit_cost,reference) VALUES(b,(body->>'target_location_id')::uuid,prod.id,op,'TRANSFER_IN',qty,cost,ref);
     END IF;
     IF kind='STOCK_ADJUSTMENT' AND ln->>'counted_quantity' IS NOT NULL THEN UPDATE products SET stock_verified=true WHERE id=prod.id; END IF;
     IF kind IN ('OPENING_BALANCE','PURCHASE_RECEIPT') THEN UPDATE products SET stock_verified=true,purchase_cost=CASE WHEN kind='PURCHASE_RECEIPT' THEN cost ELSE purchase_cost END WHERE id=prod.id; END IF;
   END LOOP;
   IF kind='SALE' THEN
     disc:=COALESCE((body->>'discount')::numeric,0);total:=subtotal-disc;
     IF disc<0 OR disc>subtotal OR disc<>round(disc,2) OR (body->>'tendered')::numeric<total OR body->>'tendered' IS NULL THEN RAISE EXCEPTION 'Diskon atau pembayaran tidak valid'; END IF;
     INSERT INTO sales(business_id,operation_id,reference,total,discount,cost_total,payment_method,tendered) VALUES(b,op,ref,total,disc,cost_total,body->>'payment_method',(body->>'tendered')::numeric) RETURNING id INTO sale;
     INSERT INTO sales_lines(sale_id,product_id,quantity,unit_price,unit_cost,line_total) SELECT sale,(x->>'product_id')::uuid,(x->>'quantity')::numeric,(x->>'unit_price')::numeric,m.unit_cost,round((x->>'quantity')::numeric*(x->>'unit_price')::numeric,2) FROM jsonb_array_elements(body->'lines') x JOIN inventory_movements m ON m.operation_id=op AND m.product_id=(x->>'product_id')::uuid;
   ELSIF kind='PURCHASE_RECEIPT' THEN
     subtotal:=inv_total;total:=inv_total-v_header_discount+v_header_tax+v_rounding;
     IF COALESCE((body->>'discount')::numeric,0)<0 OR COALESCE((body->>'discount')::numeric,0)>inv_total OR COALESCE((body->>'tax')::numeric,0)<0 OR total<0 OR total<>round(total,2) THEN RAISE EXCEPTION 'Total faktur tidak valid'; END IF;
     IF body->>'printed_total' IS NOT NULL AND abs((body->>'printed_total')::numeric-total)>0.01 THEN RAISE EXCEPTION 'Total nota tidak sesuai. Koreksi sebelum konfirmasi.'; END IF;
     INSERT INTO supplier_invoices(business_id,supplier_id,operation_id,receipt_id,invoice_number,invoice_date,delivery_date,due_date,subtotal,total,status,match_warnings)
     VALUES(b,supp,op,receipt,body->>'invoice_number',(body->>'invoice_date')::date,NULLIF(body->>'delivery_date','')::date,NULLIF(body->>'due_date','')::date,subtotal,total,CASE WHEN v_warnings='[]'::jsonb THEN CASE WHEN total=0 THEN 'paid' ELSE 'approved' END ELSE 'blocked' END,v_warnings) RETURNING id INTO inv;
     INSERT INTO supplier_invoice_lines(invoice_id,product_id,quantity,unit,unit_price,discount,tax,line_total) SELECT inv,(x->>'product_id')::uuid,(x->>'quantity')::numeric,x->>'unit',(x->>'unit_price')::numeric,COALESCE((x->>'discount')::numeric,0),COALESCE((x->>'tax')::numeric,0),round((x->>'quantity')::numeric*(x->>'unit_price')::numeric-COALESCE((x->>'discount')::numeric,0)+COALESCE((x->>'tax')::numeric,0),2) FROM jsonb_array_elements(body->'lines') x;
     UPDATE goods_receipts SET discrepancies=v_warnings WHERE id=receipt;
     IF ord IS NOT NULL THEN UPDATE purchase_orders SET status=CASE WHEN EXISTS(SELECT 1 FROM purchase_order_lines WHERE order_id=ord AND received_quantity<quantity) THEN 'partial' ELSE 'received' END WHERE id=ord; END IF;
   END IF;
 END IF;
 IF kind IN ('PURCHASE_RECEIPT','OPENING_BALANCE') AND body->>'draft_id' IS NOT NULL THEN UPDATE ocr_review_drafts SET status='confirmed',updated_at=now() WHERE business_id=b AND id=(body->>'draft_id')::uuid; END IF;
 INSERT INTO audit_logs(business_id,actor_id,action,entity_type,entity_id,data) VALUES(b,actor,'POST_'||kind,'operation',op::text,jsonb_build_object('reference',ref,'total',total,'warnings',v_warnings));
 RETURN jsonb_build_object('id',op,'reference',ref,'total',total,'invoice_id',inv,'sale_id',sale,'warnings',v_warnings,'replayed',false);
END $$;
