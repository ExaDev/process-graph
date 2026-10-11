CREATE TABLE `relations` (
	`model_id` text NOT NULL,
	`kind` text NOT NULL,
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `relations_pk` PRIMARY KEY(`model_id`, `kind`, `from_id`, `to_id`)
);
--> statement-breakpoint
CREATE INDEX `relations_by_to` ON `relations` (`model_id`,`kind`,`to_id`);