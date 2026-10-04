CREATE TABLE IF NOT EXISTS delivery_attempts (
 id CHAR(36) PRIMARY KEY, order_id BIGINT UNSIGNED NOT NULL,
 employee_id BIGINT UNSIGNED NOT NULL, assignment_version INT UNSIGNED NOT NULL,
 started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, ended_at DATETIME NULL,
 end_reason VARCHAR(40) NULL,
 FOREIGN KEY(order_id) REFERENCES orders(id), FOREIGN KEY(employee_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS delivery_active_jobs (
 employee_id BIGINT UNSIGNED PRIMARY KEY, order_id BIGINT UNSIGNED NOT NULL UNIQUE,
 attempt_id CHAR(36) NOT NULL UNIQUE,
 FOREIGN KEY(employee_id) REFERENCES users(id), FOREIGN KEY(order_id) REFERENCES orders(id),
 FOREIGN KEY(attempt_id) REFERENCES delivery_attempts(id)
);
CREATE TABLE IF NOT EXISTS delivery_location_sessions (
 id CHAR(36) PRIMARY KEY, attempt_id CHAR(36) NOT NULL,
 token_version INT UNSIGNED NOT NULL, started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ended_at DATETIME NULL,
 expires_at DATETIME NULL,
 FOREIGN KEY(attempt_id) REFERENCES delivery_attempts(id)
);
CREATE TABLE IF NOT EXISTS delivery_latest_positions (
 session_id CHAR(36) PRIMARY KEY, latitude DECIMAL(10,7) NOT NULL,
 longitude DECIMAL(10,7) NOT NULL, accuracy DOUBLE NOT NULL,
 observed_at DATETIME(3) NOT NULL, received_at DATETIME(3) NOT NULL,
 sequence BIGINT UNSIGNED NOT NULL,
 FOREIGN KEY(session_id) REFERENCES delivery_location_sessions(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS delivery_issues (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, order_id BIGINT UNSIGNED NOT NULL,
 employee_id BIGINT UNSIGNED NOT NULL, explanation VARCHAR(500) NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 resolved_by BIGINT UNSIGNED NULL, resolved_at DATETIME NULL, resolution VARCHAR(500) NULL,
 INDEX(order_id,resolved_at), FOREIGN KEY(order_id) REFERENCES orders(id),
 FOREIGN KEY(employee_id) REFERENCES users(id), FOREIGN KEY(resolved_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS delivery_photos (
 id CHAR(36) PRIMARY KEY, order_id BIGINT UNSIGNED NOT NULL, uploader_id BIGINT UNSIGNED NOT NULL,
 assignment_version INT UNSIGNED NOT NULL, storage_key VARCHAR(80) NOT NULL UNIQUE,
 state ENUM('STAGED','COMMITTED','PURGED') NOT NULL DEFAULT 'STAGED',
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL,
 byte_size INT UNSIGNED NOT NULL,
 INDEX(state,expires_at), FOREIGN KEY(order_id) REFERENCES orders(id), FOREIGN KEY(uploader_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS delivery_completions (
 order_id BIGINT UNSIGNED PRIMARY KEY, recipient_name VARCHAR(160) NOT NULL,
 actor_id BIGINT UNSIGNED NOT NULL, completed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 photo_id CHAR(36) NULL UNIQUE, exception_reason VARCHAR(500) NULL,
 FOREIGN KEY(order_id) REFERENCES orders(id), FOREIGN KEY(actor_id) REFERENCES users(id),
 FOREIGN KEY(photo_id) REFERENCES delivery_photos(id)
);
