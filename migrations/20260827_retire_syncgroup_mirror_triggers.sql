-- 退役「三表 syncGroupCode 镜像同步」（2026-08-27 架构转向：客户/公司=去重主数据，线索/项目引用）
-- 只删触发器，保留底层函数（回滚=重建触发器，见 ROLLBACK 文件）。
-- 保留的工具触发器：opportunity_leadno_default_trg、opportunity_website_form_default_stage_before_insert。
-- 无历史数据迁移（存量上线前清库）。

\set schema workspace_3zyju8y4v9gnoifvksi4cn23f

-- 字段镜像同步（1:1:1）
DROP TRIGGER IF EXISTS opportunity_sync_shared_fields_after_write ON :"schema".opportunity;
DROP TRIGGER IF EXISTS person_sync_shared_fields_after_write ON :"schema".person;
DROP TRIGGER IF EXISTS project_sync_shared_fields_after_write ON :"schema"."_xiangMu";

-- owner/联系人 镜像
DROP TRIGGER IF EXISTS opportunity_owner_contact_sync_after_write ON :"schema".opportunity;
DROP TRIGGER IF EXISTS person_owner_contact_sync_after_write ON :"schema".person;
DROP TRIGGER IF EXISTS project_owner_contact_sync_after_write ON :"schema"."_xiangMu";

-- 官网链接镜像
DROP TRIGGER IF EXISTS opportunity_customer_website_sync_after_write ON :"schema".opportunity;
DROP TRIGGER IF EXISTS person_customer_website_sync_after_write ON :"schema".person;
DROP TRIGGER IF EXISTS project_customer_website_sync_after_write ON :"schema"."_xiangMu";

-- 联系人姓名镜像
DROP TRIGGER IF EXISTS opportunity_website_contact_name_sync_after_update ON :"schema".opportunity;

-- syncGroupCode 分配/解析
DROP TRIGGER IF EXISTS opportunity_sync_group_code_before_insert ON :"schema".opportunity;
DROP TRIGGER IF EXISTS person_resolve_sync_group_before_write ON :"schema".person;
DROP TRIGGER IF EXISTS project_resolve_sync_group_before_write ON :"schema"."_xiangMu";

-- 官网表单线索去重（新模型：线索不去重，只客户去重）
DROP TRIGGER IF EXISTS opportunity_website_form_contact_dedup_after_insert ON :"schema".opportunity;
