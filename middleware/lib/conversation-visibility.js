function conversationVisibilityWhere(viewer, alias = 'c', startIndex = 1) {
  // v2.1：拥有 boss 角色（仅查看总经理）或 admin 角色（scope=all）可见全部会话；未登录不可见。
  if (!viewer) return { sql: 'FALSE', params: [] };
  if (viewer.role === 'admin' || viewer.role === 'boss') return { sql: 'TRUE', params: [] };
  const memberParam = `$${startIndex}`;
  const userParam = `$${startIndex + 1}`;
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
      )
    ) OR (
      ${alias}.channel = 'whatsapp'
      AND ${alias}.owner_id = ${userParam}
    ) OR ${alias}.channel IN ('email', 'instagram', 'facebook'))`,
    params: [viewer.workspaceMemberId, viewer.userId],
  };
}

module.exports = {
  conversationVisibilityWhere,
};
