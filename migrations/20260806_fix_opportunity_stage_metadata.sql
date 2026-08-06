-- Keep Opportunity stage metadata aligned with the CRM business vocabulary.
-- The physical enum values are already correct; this migration fixes the
-- Twenty metadata labels that drive table headers and select option labels.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT fm.id
      FROM core."fieldMetadata" fm
      JOIN core."objectMetadata" om ON om.id = fm."objectMetadataId"
     WHERE om."nameSingular" = 'opportunity'
       AND fm.name = 'stage'
       AND om."isActive" = true
       AND fm."isActive" = true
  LOOP
    UPDATE core."fieldMetadata"
       SET label = '任务进度',
           options = jsonb_build_array(
             jsonb_build_object('id', '708510b3-c7f9-4490-8d40-c8c796f0dc57', 'color', 'gray', 'label', '未处理线索', 'value', 'XIANSUO', 'position', 0),
             jsonb_build_object('id', '11805036-5fed-43b3-9ed6-917636f5ac3a', 'color', 'sky', 'label', '有效线索', 'value', 'YOUXIAO_XIANSUO', 'position', 1),
             jsonb_build_object('id', 'c4d8e0f4-87bf-4ed2-b6b3-efd89a05467b', 'color', 'blue', 'label', '询价', 'value', 'XUNJIA', 'position', 2),
             jsonb_build_object('id', '780608be-932c-4937-8401-a69e94226a9d', 'color', 'turquoise', 'label', '报价', 'value', 'BAOJIA', 'position', 3),
             jsonb_build_object('id', 'da8f40cf-efe5-43dc-abbb-07d9972f79af', 'color', 'purple', 'label', '审样', 'value', 'SHENYANG', 'position', 4),
             jsonb_build_object('id', '8f163986-6f8a-4330-91ac-7b3ba0e44190', 'color', 'pink', 'label', '谈判', 'value', 'TANPAN', 'position', 5),
             jsonb_build_object('id', 'deb570fd-3aa8-4b3b-8811-2b328d5b5a20', 'color', 'orange', 'label', '已下单', 'value', 'YIXIADAN', 'position', 6),
             jsonb_build_object('id', 'c2b569ff-1d29-4bc8-8a80-0bcbb7ba005d', 'color', 'yellow', 'label', '已付款', 'value', 'YIFUKUAN', 'position', 7),
             jsonb_build_object('id', '38c3beb3-6adc-44d4-a43b-b18d7ffefc74', 'color', 'sky', 'label', '已发货', 'value', 'YIFAHUO', 'position', 8),
             jsonb_build_object('id', 'f0c880e7-7bc4-47b1-983f-f83c6d82a79c', 'color', 'green', 'label', '已成交', 'value', 'YICHENGJIAO', 'position', 9)
           ),
           "defaultValue" = '"''XIANSUO''"'::jsonb,
           "isLabelSyncedWithName" = false,
           "updatedAt" = now()
     WHERE id = r.id;
  END LOOP;
END $$;
