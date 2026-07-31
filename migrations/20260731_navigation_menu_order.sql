-- 主菜单顺序：对话工作台、邮箱由前端注入固定在顶部；
-- Twenty 原生对象菜单按 商机 -> 联系人 -> 项目 -> 对话历史 排序。
DO $$
DECLARE
  ws uuid;
BEGIN
  FOR ws IN SELECT id FROM core.workspace LOOP
    UPDATE core."navigationMenuItem" n
    SET
      position = CASE om."namePlural"
        WHEN 'opportunities' THEN 0
        WHEN 'people' THEN 1
        WHEN 'xiangMus' THEN 2
        WHEN 'duiHuaLiShis' THEN 3
        ELSE n.position
      END,
      "updatedAt" = now()
    FROM core."objectMetadata" om
    WHERE om.id = n."targetObjectMetadataId"
      AND n."workspaceId" = ws
      AND om."workspaceId" = ws
      AND om."namePlural" IN ('opportunities', 'people', 'xiangMus', 'duiHuaLiShis');
  END LOOP;
END $$;
