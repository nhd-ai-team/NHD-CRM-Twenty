-- 项目(xiangMu) 字段清理（2026-08-26，用户决策）
-- 前置：scripts/ensure-project-typefix-fields.mjs 已建两个正确类型的新字段
--       xunPanRiQi(DATE_TIME)、chengBenJiaGe(CURRENCY)
--
-- 本文件：把旧文本字段数据迁到新类型字段 + 停用旧字段/弃用联系人文本字段。
-- 停用=isActive=false（隐藏，保留列与数据，可回滚）。
-- 回滚：把下方 isActive 改回 true 即可恢复旧字段显示；新字段可用
--       scripts 的 deleteOneField 反向删除（数据在旧列仍在）。
--
-- 决策对应：
--   #3 项目「联系人」文本字段弃用（改用 pointOfContact 关系）→ 停用 lianXiRen
--   #5 类型修正：xunPanShiJian(TEXT 年/月) → xunPanRiQi(DATE_TIME 月初)
--                xiangMuChengBenJie(TEXT) → chengBenJiaGe(CURRENCY)
-- 注：lianXiRen 列仍被 conv.sync_owner_contact_* 触发器维护（写入无害），
--     停用仅隐藏 UI；后续如需彻底移除，需先从这些触发器摘除引用。

\set schema workspace_3zyju8y4v9gnoifvksi4cn23f

-- 数据迁移
UPDATE :"schema"."_xiangMu"
SET "xunPanRiQi" = to_date("xunPanShiJian",'YYYY/MM')::timestamptz
WHERE "deletedAt" IS NULL
  AND NULLIF("xunPanShiJian",'') IS NOT NULL
  AND "xunPanShiJian" ~ '^[0-9]{4}/[0-9]{1,2}$'
  AND "xunPanRiQi" IS NULL;

UPDATE :"schema"."_xiangMu"
SET "chengBenJiaGeAmountMicros" = round("xiangMuChengBenJie"::numeric * 1000000),
    "chengBenJiaGeCurrencyCode" = COALESCE(NULLIF("jinECurrencyCode",''),'USD')
WHERE "deletedAt" IS NULL
  AND NULLIF("xiangMuChengBenJie",'') IS NOT NULL
  AND "xiangMuChengBenJie" ~ '^[0-9]+(\.[0-9]+)?$'
  AND "chengBenJiaGeAmountMicros" IS NULL;

-- 停用旧字段 / 弃用联系人文本字段
UPDATE core."fieldMetadata" SET "isActive"=false
WHERE "objectMetadataId"='2fcf7216-6745-4824-820e-79e71e8249e0'
  AND name IN ('lianXiRen','xunPanShiJian','xiangMuChengBenJie');
