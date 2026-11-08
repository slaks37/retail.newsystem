CREATE UNIQUE INDEX product_sku_normalized ON products(business_id,upper(btrim(sku)));
