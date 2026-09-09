function conversationVisibilityWhere(viewer, alias = 'c', startIndex = 1, options = {}) {
  if (!viewer) return { sql: 'FALSE', params: [] };
  const memberParam = `$${startIndex}`;
  const userParam = `$${startIndex + 1}`;
  const workspaceSchema = options.workspaceSchema || '';
  const ownWhatsAppSql = `EXISTS (
      SELECT 1
      FROM conv.channel_accounts ca
      WHERE ca.channel = 'whatsapp'
        AND ca.provider = 'waha'
        AND ca.status <> 'unbound'
        AND ca.user_id = ${userParam}
        AND ca.provider_session IS NOT NULL
        AND ${alias}.waha_session = ca.provider_session
    )`;

  const linkedCrmAssigneeSql = /^workspace_[a-z0-9]+$/.test(workspaceSchema)
    ? `OR EXISTS (
          SELECT 1
          FROM conv.contacts ct
          JOIN ${workspaceSchema}.opportunity o
            ON o.id::text = ct.twenty_opportunity_id
           AND o."deletedAt" IS NULL
          LEFT JOIN ${workspaceSchema}.person p
            ON p."deletedAt" IS NULL
           AND (
             p.id = o."linkedPersonId"
             OR p.id = o."pointOfContactId"
             OR p."sourceOpportunityId" = o.id
             OR (o."syncGroupCode" IS NOT NULL AND p."syncGroupCode" = o."syncGroupCode")
           )
          LEFT JOIN ${workspaceSchema}."_xiangMu" xm
            ON xm."deletedAt" IS NULL
           AND (
             xm.id = o."linkedProjectId"
             OR xm."sourceOpportunityId" = o.id
             OR (o."syncGroupCode" IS NOT NULL AND xm."syncGroupCode" = o."syncGroupCode")
           )
          WHERE ct.id = ${alias}.contact_id
            AND (
              o."ownerId" = ${memberParam}::uuid
              OR o."xieBanRenId" = ${memberParam}::uuid
              OR o."xieZuoRen2Id" = ${memberParam}::uuid
              OR p."ownerId" = ${memberParam}::uuid
              OR p."xieBanRenId" = ${memberParam}::uuid
              OR p."xieZuoRen2Id" = ${memberParam}::uuid
              OR xm."ownerId" = ${memberParam}::uuid
              OR xm."xieBanRenId" = ${memberParam}::uuid
              OR xm."xieZuoRen2Id" = ${memberParam}::uuid
            )
        )`
    : '';

  // 沟通状态是管理视图：只有 boss/主管可看全部会话；普通销售必须与会话关联。
  // 这条规则不能复用工作台的 website/email 公共入口规则，否则销售会看到全量历史。
  if (options.allowPrivilegedAllChannels && ['boss', 'manager'].includes(viewer.role)) {
    return {
      sql: `(${memberParam}::text IS NOT NULL OR ${userParam}::text IS NOT NULL OR TRUE)`,
      params: [viewer.workspaceMemberId, viewer.userId],
    };
  }

  // WhatsApp 是个人渠道：不管 admin/boss/sales，都只能看到自己绑定 Session 下的会话。
  // 不使用 owner_id/channel_owner_id 兜底，避免历史负责人字段错配造成跨账号串看。
  if (!options.allowPrivilegedAllChannels && (viewer.role === 'admin' || viewer.role === 'boss')) {
    return {
      sql: `((${memberParam}::text IS NOT NULL OR TRUE) AND (${alias}.channel <> 'whatsapp' OR (${alias}.channel = 'whatsapp' AND ${ownWhatsAppSql})))`,
      params: [viewer.workspaceMemberId, viewer.userId],
    };
  }

  const relatedConversationSql = `(
    ${alias}.owner_id = ${userParam}
    OR ${alias}.agent_id = ${memberParam}
    OR EXISTS (
      SELECT 1
      FROM conv.conversation_participants cp
      WHERE cp.conversation_id = ${alias}.id
        AND cp.workspace_member_id = ${memberParam}
    )
    ${linkedCrmAssigneeSql}
  )`;
  if (options.allowPrivilegedAllChannels) {
    return {
      sql: `((${alias}.channel = 'whatsapp' AND ${ownWhatsAppSql}) OR (${alias}.channel <> 'whatsapp' AND ${relatedConversationSql}))`,
      params: [viewer.workspaceMemberId, viewer.userId],
    };
  }

  const assignedChannelVisibilitySql = `(
      ${alias}.channel IN ('instagram', 'facebook')
      AND (
        ${alias}.status = 'open'
        OR ${alias}.agent_id = ${memberParam}
        OR EXISTS (
          SELECT 1
          FROM conv.conversation_participants cp
          WHERE cp.conversation_id = ${alias}.id
            AND cp.workspace_member_id = ${memberParam}
        )
        ${linkedCrmAssigneeSql}
      )
    )`;
  return {
    sql: `(${alias}.channel IN ('website', 'email') OR ${assignedChannelVisibilitySql} OR (
      ${alias}.channel = 'whatsapp'
      AND ${ownWhatsAppSql}
    ))`,
    params: [viewer.workspaceMemberId, viewer.userId],
  };
}

module.exports = {
  conversationVisibilityWhere,
};
