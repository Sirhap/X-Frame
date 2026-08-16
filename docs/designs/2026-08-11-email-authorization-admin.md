# 邮箱授权后台技术设计

## 1. 目标与范围

授权系统以已验证邮箱账户为唯一主体，不再出现设备、浏览器指纹或设备解绑概念。本设计覆盖后台的高、中优先级运营能力：

- 邮箱试用管理：查询、筛选、撤销、恢复、延长和提前结束试用。
- 授权审计日志：可追溯的查询、筛选与导出。
- 邮箱授权总览：以账户为中心呈现试用、激活码、管理员授予和有效期。
- 单邮箱直接授权：授予、调整、撤销和恢复限时或永久 Pro。
- 账户风控：强制下线、禁用、恢复、删除账户。
- 批量运营：批量授权、撤销、延长、导入和导出。
- 运营数据看板：账户、试用、转化、授权和到期指标。

不在本期范围：支付、订阅自动续费、多管理员角色、外部 CRM 同步。

## 2. 领域模型

### 2.1 授权来源

`licenses` 保留为不可变授权凭证表，统一使用以下来源：

| source | 归属 | 说明 |
| --- | --- | --- |
| `code` | 可在兑换前为空，兑换后绑定邮箱 | 激活码兑换结果。 |
| `email_trial` | 必须绑定邮箱 | 每邮箱最多一条试用领取记录。 |
| `admin_grant` | 必须绑定邮箱 | 管理员直接发放的限时或永久授权。 |

账户的最终 Pro 状态由以下优先级决定：账户禁用 > 管理员禁用覆盖 > 有效授权（`admin_grant`、`code`、`email_trial`）> 默认策略。

### 2.2 账户状态

`accounts` 增加显式生命周期字段：

- `status`: `active`、`suspended`、`deleted`。
- `suspended_at`、`suspension_reason`：保留风控原因和时间。
- `deleted_at`：软删除时间；保留审计、授权和兑换历史。

软删除账户必须立即撤销所有会话；已绑定授权不删除，但不得再被登录或使用。恢复账户不自动恢复已撤销的授权。

### 2.3 试用状态

`email_trial` 通过 `licenses` 表保存，`account_id + source = email_trial` 唯一。试用管理不删除领取记录，只变更：

- `expires_at`：延长或提前结束。
- `revoked_at`：撤销或恢复。
- `admin_note`：运营备注。

这样可保留“该邮箱是否领取过试用”的防重复依据。

## 3. 数据库设计

新增迁移，不修改历史迁移文件：

```sql
ALTER TABLE accounts ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'suspended', 'deleted'));
ALTER TABLE accounts ADD COLUMN suspended_at TEXT;
ALTER TABLE accounts ADD COLUMN suspension_reason TEXT;
ALTER TABLE accounts ADD COLUMN deleted_at TEXT;

ALTER TABLE licenses ADD COLUMN admin_note TEXT;
ALTER TABLE licenses ADD COLUMN granted_by_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_accounts_status_login ON accounts(status, last_login_at DESC);
CREATE INDEX idx_licenses_account_source_expiry ON licenses(account_id, source, revoked_at, expires_at);
CREATE INDEX idx_audit_log_created_at ON authorization_audit_log(created_at DESC);
```

`licenses.source` 的约束需通过“新表复制、切换表名”的 SQLite/D1 迁移扩展为 `code`、`email_trial`、`admin_grant`。迁移执行前应导出 D1 备份，并在维护窗口内执行。

## 4. 后端 API

所有接口位于 `/api/admin`、要求 TOTP 管理员会话、校验同源请求、写操作落审计日志。

### 4.1 账户与授权总览

- `GET /accounts?q=&status=&entitlement=&cursor=`：分页账户列表，返回邮箱、状态、最后登录、有效授权、试用状态和最近到期时间。
- `GET /accounts/:id`：账户详情、会话数量、授权时间线和审计摘要。
- `PATCH /accounts/:id/status`：暂停、恢复或软删除账户。
- `POST /accounts/:id/sessions/revoke`：强制下线全部会话。
- `GET /accounts/export?...`：异步或流式 CSV 导出。

### 4.2 邮箱试用

- `GET /trials?q=&state=&expiresBefore=&cursor=`：独立试用列表。
- `PATCH /trials/:licenseId`：更新试用到期时间或运营备注。
- `PATCH /trials/:licenseId/revocation`：撤销或恢复。

### 4.3 管理员直接授权

- `POST /grants`：为指定邮箱创建 `admin_grant`，支持天数、永久、备注。
- `PATCH /grants/:licenseId`：调整到期时间和备注。
- `PATCH /grants/:licenseId/revocation`：撤销或恢复。

邮箱不存在时，接口返回“待领取授权”而非自动创建账户；邮箱完成验证后才绑定该授权。这样不会把权限授予拼写错误或未验证邮箱。

### 4.4 批量操作与审计

- `POST /grants/batch`：最多 200 个邮箱，支持幂等键。
- `POST /accounts/batch/status`：批量暂停、恢复或强制下线。
- `GET /audit-log?action=&actor=&target=&from=&to=&cursor=`：分页审计日志。
- `GET /audit-log/export?...`：CSV 导出。
- `GET /metrics/authorization?from=&to=`：运营看板指标。

批量接口需返回逐行成功/失败结果；不得因单个邮箱非法而回滚已确认的其他邮箱。相同幂等键在 24 小时内返回同一结果。

## 5. 后台界面

后台导航调整为五个页面：

1. 概览：核心指标、到期预警、最近风控和最近授权操作。
2. 邮箱账户：分页列表、详情抽屉、状态与会话操作。
3. 授权：激活码、邮箱试用、管理员授予三个筛选页签。
4. 批量运营：CSV 粘贴/上传、预览校验、确认执行、结果下载。
5. 审计日志：按时间、操作人、目标邮箱、动作筛选并导出。

破坏性操作统一使用二次确认，确认框必须明确显示影响邮箱数、授权数以及“是否立即强制下线”。单个账户详情只显示邮箱和授权，不展示任何设备字段。

## 6. 安全与一致性

- 管理员写操作必须写入 `authorization_audit_log`，包含操作者、目标、前后状态、请求批次 ID。
- 审计日志只追加，不允许后台删除或修改。
- 账户删除为软删除；清理任务只在保留期后删除可删除数据。
- 授权判断在服务器端完成，前端仅渲染结果。
- 分页使用稳定游标 `(created_at, id)`，避免大表 OFFSET 性能退化。
- CSV 导出对邮箱做最小化暴露，仅管理员下载，响应附加 `no-store`。
- 批量上传限制 2000 行、单行 254 字符邮箱、总请求体不超过 512 KiB。

## 7. 实施顺序

### 阶段 A：基础数据与查询

1. 新增账户生命周期、管理员授权、运营备注和索引迁移。
2. 统一账户授权聚合查询，补齐试用和管理员授权统计。
3. 提供账户列表、账户详情、试用列表、审计日志只读 API 与后台页面。

### 阶段 B：单账户操作

1. 管理员直接授权、延长/撤销/恢复试用。
2. 暂停/恢复/软删除账户、强制下线。
3. 全部写操作接入审计、二次确认与回归测试。

### 阶段 C：批量与看板

1. 批量授权和批量风控操作，加入幂等键和结果报告。
2. CSV 导入导出。
3. 指标聚合、到期预警和概览卡片。

## 8. 验收标准

- 管理员能按邮箱找到账户，查看完整授权时间线。
- 管理员能对邮箱试用进行撤销、恢复、延长，且领取记录始终保留。
- 管理员能为邮箱发放限时或永久 Pro，不需要任何设备信息。
- 暂停或删除账户后，现有会话立即失效；恢复后需重新登录。
- 每一次写操作均可在审计日志中按目标和时间检索。
- 批量任务可重复提交而不重复发放授权。
- 后台与公开 API 不再出现设备、浏览器或指纹字段。
