CREATE UNIQUE INDEX operations_document_once ON operations(business_id,type,(payload->>'document_hash')) WHERE type IN ('PURCHASE_RECEIPT','OPENING_BALANCE') AND payload->>'document_hash' IS NOT NULL;
CREATE INDEX invoice_due ON supplier_invoices(business_id,due_date) WHERE status<>'paid';
CREATE INDEX source_record_scope ON source_records(business_id,sheet,row_number);
CREATE INDEX sales_line_product ON sales_lines(product_id,sale_id);
