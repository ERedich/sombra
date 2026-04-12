-- Roll back spare parts / warehouses / inventory schema and related UI strings.
DROP VIEW IF EXISTS effective_stock_policy;
DROP TABLE IF EXISTS inventory_transactions CASCADE;
DROP TABLE IF EXISTS spare_part_inventory CASCADE;
DROP TABLE IF EXISTS stock_policies CASCADE;
DROP TABLE IF EXISTS asset_spare_parts CASCADE;
DROP TABLE IF EXISTS storage_locations CASCADE;
DROP TABLE IF EXISTS warehouses CASCADE;
DROP TABLE IF EXISTS spare_parts CASCADE;
DROP TABLE IF EXISTS spare_part_categories CASCADE;

DELETE FROM ui_translations
WHERE msg_key LIKE 'spare_parts.%'
   OR msg_key LIKE 'spare_part_inventory.%'
   OR msg_key LIKE 'asset_spare_parts.%'
   OR msg_key LIKE 'warehouses.%'
   OR msg_key IN (
     'nav.warehouses',
     'nav.spare_parts',
     'nav.spare_part_inventory'
   )
   OR msg_key LIKE 'wo.feedback_spare%';
