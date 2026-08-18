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
        AND (
          ${alias}.owner_id = ca.user_id
          OR ${alias}.channel_owner_id = ca.user_id
          OR (
            ca.provider_session IS NOT NULL
            AND ${alias}.waha_session = ca.provider_session
          )
        )
    )`;

  if (
    options.allowPrivilegedAllChannels
    && ['admin', 'boss', 'manager'].includes(viewer.role)
  ) {
    return {
      sql: `(${memberParam}::text IS NOT NULL OR ${userParam}::text IS NOT NULL OR TRUE)`,
      params: [viewer.workspaceMemberId, viewer.userId],
    };
  }

  // WhatsApp 是个人渠道：不管 admin/boss/sales，都只能看到自己绑定账号下的会话。
  // 其他渠道仍保留 v2.1 角色规则：admin/boss 可看全部，销售按归属/接管关系看。
  if (viewer.role === 'admin' || viewer.role === 'boss') {
    // (${memberParam}::text IS NOT NULL OR TRUE) 恒真，仅用于给 $memberParam 指定类型，
    // 避免该分支不引用 memberParam 时 PG 报 "could not determine data type of parameter"。
    return {
      sql: `((${memberParam}::text IS NOT NULL OR TRUE) AND (${alias}.channel <> 'whatsapp' OR (${alias}.channel = 'whatsapp' AND ${ownWhatsAppSql})))`,
      params: [viewer.workspaceMemberId, viewer.userId],
    };
  }
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
              OR p."ownerId" = ${memberParam}::uuid
              OR p."xieBanRenId" = ${memberParam}::uuid
              OR xm."ownerId" = ${memberParam}::uuid
              OR xm."xieBanRenId" = ${memberParam}::uuid
            )
        )`
    : '';
  return {
    sql: `((
      ${alias}.channel = 'website'
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
    ) OR (
      ${alias}.channel = 'whatsapp'
      AND ${ownWhatsAppSql}
    ) OR ${alias}.channel IN ('email', 'instagram', 'facebook'))`,
    params: [viewer.workspaceMemberId, viewer.userId],
  };
}

module.exports = {
  conversationVisibilityWhere,
};
