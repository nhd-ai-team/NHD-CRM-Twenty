-- 主字段标签统一 + 停用公司原生 accountOwner（2026-08-26，用户决策）
-- 全部只改 label / isActive，不动任何底层 id/技术名（受保护字段合规）。
-- 回滚：把 label 改回原值、accountOwner isActive 改回 true。

-- 线索主字段：名称 -> 线索名称
UPDATE core."fieldMetadata"
SET label='线索名称', "standardOverrides"=jsonb_set(COALESCE("standardOverrides",'{}'::jsonb),'{label}','"线索名称"')
WHERE "objectMetadataId"='23e6327b-0663-4499-9293-76f362c4d33b' AND name='name';

-- 客户主字段：联系人 -> 客户联系人
UPDATE core."fieldMetadata"
SET label='客户联系人', "standardOverrides"=jsonb_set(COALESCE("standardOverrides",'{}'::jsonb),'{label}','"客户联系人"')
WHERE "objectMetadataId"='f8d128b7-2175-4fd0-a0b0-53851a106bad' AND name='name';

-- 项目主字段：项目名称（已在 20260826_direction_a_decouple_project_name.sql 设置，此处幂等重申）
UPDATE core."fieldMetadata"
SET label='项目名称', "standardOverrides"=jsonb_set(COALESCE("standardOverrides",'{}'::jsonb),'{label}','"项目名称"')
WHERE "objectMetadataId"='2fcf7216-6745-4824-820e-79e71e8249e0' AND name='name';

-- #4 公司原生 accountOwner「Account Owner」与自建 owner「负责人」重复，停用（隐藏，保留数据）
UPDATE core."fieldMetadata" SET "isActive"=false
WHERE "objectMetadataId"='3ac4b1c8-fdda-45c8-9637-512c5dc3ffc1' AND name='accountOwner';
