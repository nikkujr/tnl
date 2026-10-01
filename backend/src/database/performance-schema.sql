CREATE TABLE IF NOT EXISTS agent_targets (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  agent_id BIGINT UNSIGNED NOT NULL,
  period CHAR(7) NOT NULL,
  sales_target DECIMAL(12,2) NOT NULL,
  incentive_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_agent_target_month (agent_id,period),
  FOREIGN KEY (agent_id) REFERENCES users(id),
  FOREIGN KEY (updated_by) REFERENCES users(id),
  CHECK (sales_target > 0 AND incentive_amount >= 0)
);

CREATE TABLE IF NOT EXISTS agent_rewards (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  agent_id BIGINT UNSIGNED NOT NULL,
  period CHAR(7) NOT NULL,
  kind ENUM('INCENTIVE','BONUS') NOT NULL,
  target_id BIGINT UNSIGNED NULL UNIQUE,
  amount DECIMAL(12,2) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  approved_by BIGINT UNSIGNED NOT NULL,
  idempotency_key VARCHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_agent_reward_period (period,agent_id),
  FOREIGN KEY (agent_id) REFERENCES users(id),
  FOREIGN KEY (target_id) REFERENCES agent_targets(id),
  FOREIGN KEY (approved_by) REFERENCES users(id),
  CHECK (amount > 0),
  CHECK ((kind='INCENTIVE' AND target_id IS NOT NULL) OR (kind='BONUS' AND target_id IS NULL))
);
