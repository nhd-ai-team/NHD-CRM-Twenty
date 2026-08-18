-- 历史对齐：官网客服(GUAN_WANG_KE_FU)来源的线索，初始状态统一为「线索(XIANSUO)」
-- 「未处理线索(WEI_CHU_LI_XIANSUO)」仅保留给官网表单(GUAN_WANG_BIAO_DAN)来源。
UPDATE workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity
  SET stage = 'XIANSUO'
  WHERE "keHuLaiYuan" = 'GUAN_WANG_KE_FU'
    AND stage = 'WEI_CHU_LI_XIANSUO';
