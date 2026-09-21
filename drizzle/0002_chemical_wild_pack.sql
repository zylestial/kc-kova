CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_username_unique` ON `accounts` (`username`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`count` text NOT NULL,
	`window_start` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `fleet` ADD `status` text DEFAULT 'Active' NOT NULL;
--> statement-breakpoint
CREATE TRIGGER keep_one_admin BEFORE UPDATE ON accounts
WHEN OLD.role='Admin' AND OLD.status='Active' AND (NEW.role<>'Admin' OR NEW.status<>'Active') AND (SELECT count(*) FROM accounts WHERE role='Admin' AND status='Active')=1
BEGIN SELECT RAISE(ABORT, 'Keep at least one active Admin'); END;
--> statement-breakpoint
CREATE TRIGGER block_inactive_vehicle BEFORE INSERT ON bookings
WHEN EXISTS (SELECT 1 FROM fleet WHERE plate=NEW.plate AND status='Inactive')
BEGIN SELECT RAISE(ABORT, 'Vehicle is inactive'); END;
