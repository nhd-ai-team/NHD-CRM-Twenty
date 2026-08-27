-- 回滚：重建被 20260827_retire_syncgroup_mirror_triggers.sql 删除的触发器（函数从未删除）。
-- 与退役前定义一致。

CREATE TRIGGER opportunity_sync_group_code_before_insert BEFORE INSERT ON workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity FOR EACH ROW EXECUTE FUNCTION conv.ensure_opportunity_sync_group_code();
CREATE TRIGGER opportunity_sync_shared_fields_after_write AFTER INSERT OR UPDATE ON workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity FOR EACH ROW EXECUTE FUNCTION conv.sync_from_opportunity();
CREATE TRIGGER person_sync_shared_fields_after_write AFTER INSERT OR UPDATE ON workspace_3zyju8y4v9gnoifvksi4cn23f.person FOR EACH ROW EXECUTE FUNCTION conv.sync_from_person();
CREATE TRIGGER project_sync_shared_fields_after_write AFTER INSERT OR UPDATE ON workspace_3zyju8y4v9gnoifvksi4cn23f."_xiangMu" FOR EACH ROW EXECUTE FUNCTION conv.sync_from_project();
CREATE TRIGGER opportunity_customer_website_sync_after_write AFTER INSERT OR UPDATE OF "guanWangLianJiePrimaryLinkUrl", "guanWangLianJiePrimaryLinkLabel", "guanWangLianJieSecondaryLinks", "syncGroupCode" ON workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity FOR EACH ROW EXECUTE FUNCTION conv.sync_customer_website();
CREATE TRIGGER person_customer_website_sync_after_write AFTER INSERT OR UPDATE OF "guanWangLianJiePrimaryLinkUrl", "guanWangLianJiePrimaryLinkLabel", "guanWangLianJieSecondaryLinks", "syncGroupCode" ON workspace_3zyju8y4v9gnoifvksi4cn23f.person FOR EACH ROW EXECUTE FUNCTION conv.sync_customer_website();
CREATE TRIGGER project_customer_website_sync_after_write AFTER INSERT OR UPDATE OF "guanWangLianJiePrimaryLinkUrl", "guanWangLianJiePrimaryLinkLabel", "guanWangLianJieSecondaryLinks", "syncGroupCode" ON workspace_3zyju8y4v9gnoifvksi4cn23f."_xiangMu" FOR EACH ROW EXECUTE FUNCTION conv.sync_customer_website();
CREATE TRIGGER person_resolve_sync_group_before_write BEFORE INSERT OR UPDATE ON workspace_3zyju8y4v9gnoifvksi4cn23f.person FOR EACH ROW EXECUTE FUNCTION conv.resolve_person_sync_group();
CREATE TRIGGER project_resolve_sync_group_before_write BEFORE INSERT OR UPDATE ON workspace_3zyju8y4v9gnoifvksi4cn23f."_xiangMu" FOR EACH ROW EXECUTE FUNCTION conv.resolve_project_sync_group();
CREATE TRIGGER opportunity_owner_contact_sync_after_write AFTER INSERT OR UPDATE ON workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity FOR EACH ROW EXECUTE FUNCTION conv.sync_owner_contact_from_opportunity();
CREATE TRIGGER person_owner_contact_sync_after_write AFTER INSERT OR UPDATE ON workspace_3zyju8y4v9gnoifvksi4cn23f.person FOR EACH ROW EXECUTE FUNCTION conv.sync_owner_contact_from_person();
CREATE TRIGGER project_owner_contact_sync_after_write AFTER INSERT OR UPDATE ON workspace_3zyju8y4v9gnoifvksi4cn23f."_xiangMu" FOR EACH ROW EXECUTE FUNCTION conv.sync_owner_contact_from_project();
CREATE TRIGGER opportunity_website_contact_name_sync_after_update AFTER UPDATE ON workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity FOR EACH ROW EXECUTE FUNCTION conv.sync_website_contact_name_to_person();
CREATE TRIGGER opportunity_website_form_contact_dedup_after_insert AFTER INSERT ON workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity FOR EACH ROW EXECUTE FUNCTION conv.dedup_website_form_opportunity();
