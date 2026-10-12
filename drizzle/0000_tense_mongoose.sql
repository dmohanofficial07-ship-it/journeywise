CREATE TABLE `booking_attempts` (
	`offer_id` text PRIMARY KEY NOT NULL,
	`intent_id` text NOT NULL,
	`state` text NOT NULL,
	`receipt` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_attempts_intent_id_unique` ON `booking_attempts` (`intent_id`);