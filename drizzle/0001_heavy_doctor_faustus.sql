CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `local_auth_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `local_credentials` (
	`email` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`password_hash` text NOT NULL,
	`salt` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `local_credentials_account_id_unique` ON `local_credentials` (`account_id`);--> statement-breakpoint
CREATE TABLE `local_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `local_sessions_expiry_idx` ON `local_sessions` (`expires_at`);--> statement-breakpoint
ALTER TABLE `booking_attempts` ADD `owner_id` text REFERENCES accounts(id);--> statement-breakpoint
ALTER TABLE `booking_attempts` ADD `context` text;--> statement-breakpoint
CREATE INDEX `booking_owner_created_idx` ON `booking_attempts` (`owner_id`,`created_at`,`intent_id`);