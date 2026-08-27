-- 公司名称字段统一（2026-08-27 用户决策）
-- 目标：线索/客户/项目 的「公司名称」统一走 company 关系（方向A 单一真相），
--       每个对象只保留一个公司相关字段；停用客户的冗余文本字段 gongSiMingCheng。
-- 全部只改 label / isActive，不动底层 id。停用=隐藏，保留列与数据可回滚。
-- 回滚：label 改回、gongSiMingCheng isActive 改回 true。
-- 注：gongSiMingCheng 列仍存在，如被触发器引用不受影响（停用仅隐藏 UI）。

-- 线索 + 客户 的 company 关系标签统一为「公司」（原为英文 Company）；项目已是「公司」。
UPDATE core."fieldMetadata"
SET label='公司', "standardOverrides"=jsonb_set(COALESCE("standardOverrides",'{}'::jsonb),'{label}','"公司"')
WHERE "workspaceId"='438bc184-abf4-4992-8de4-c2669c4ca65b' AND name='company' AND type='RELATION'
  AND "objectMetadataId" IN (
    '23e6327b-0663-4499-9293-76f362c4d33b',  -- opportunity
    'f8d128b7-2175-4fd0-a0b0-53851a106bad'   -- person
  );

-- 停用客户冗余文本字段 gongSiMingCheng（公司名称统一走 company 关系）
UPDATE core."fieldMetadata" SET "isActive"=false
WHERE "objectMetadataId"='f8d128b7-2175-4fd0-a0b0-53851a106bad' AND name='gongSiMingCheng';
