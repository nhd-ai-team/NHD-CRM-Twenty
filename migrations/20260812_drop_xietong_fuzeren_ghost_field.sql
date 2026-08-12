-- 清除半残的「协同负责人」(xieTongFuZeRen) 幽灵字段
-- 背景：2026-08-12 01:27 在 opportunity/person 建的 TEXT 字段，物理列创建被 01:49
-- 容器重建打断，留下 元数据在/列缺失 的状态，v2.17 ORM 把它拼进 INSERT 导致
-- opportunity/person 建单全 500。xiangMu 的已用 deleteOneField API 删除；
-- opportunity/person 的被 API 拒（"Cannot delete standard field"），此处走 DB 清理。
-- 用户已确认删除。引用检查：仅 core.viewField 有 1 行引用，其余 FK 均 0。
-- 幂等：用 IN + IF EXISTS，可重复执行。

BEGIN;

-- 1) 先删视图列引用（唯一 FK 引用）
DELETE FROM core."viewField"
WHERE "fieldMetadataId" IN (
  'e92d8c44-9c09-4f18-b05c-30155693d168',  -- opportunity.xieTongFuZeRen
  '2ba022e8-5e11-480b-a210-5b2230b0427b'   -- person.xieTongFuZeRen
);

-- 2) 删字段元数据
DELETE FROM core."fieldMetadata"
WHERE id IN (
  'e92d8c44-9c09-4f18-b05c-30155693d168',
  '2ba022e8-5e11-480b-a210-5b2230b0427b'
);

-- 3) 顺手 drop 掉之前为恢复服务补的空物理列（无数据）
ALTER TABLE "workspace_3zyju8y4v9gnoifvksi4cn23f".opportunity DROP COLUMN IF EXISTS "xieTongFuZeRen";
ALTER TABLE "workspace_3zyju8y4v9gnoifvksi4cn23f".person       DROP COLUMN IF EXISTS "xieTongFuZeRen";

COMMIT;
