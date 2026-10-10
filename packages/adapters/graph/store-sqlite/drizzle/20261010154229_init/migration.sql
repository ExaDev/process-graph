CREATE TABLE `actions` (
	`model_id` text NOT NULL,
	`id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	CONSTRAINT `actions_pk` PRIMARY KEY(`model_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `artefacts` (
	`model_id` text NOT NULL,
	`id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`deliverable` integer,
	CONSTRAINT `artefacts_pk` PRIMARY KEY(`model_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `elements` (
	`model_id` text NOT NULL,
	`id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`label` text,
	`actor` text,
	`action` text,
	`source` text,
	`affects` text,
	`consumes` text,
	`produces` text,
	`parent` text,
	`entry` text,
	`exit` text,
	`role` text,
	`from_actor` text,
	`to_actor` text,
	`mode` text,
	`event` text,
	`extensions` text,
	CONSTRAINT `elements_pk` PRIMARY KEY(`model_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`model_id` text NOT NULL,
	`id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`payload` text,
	CONSTRAINT `events_pk` PRIMARY KEY(`model_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `fragments` (
	`model_id` text NOT NULL,
	`id` text NOT NULL,
	`position` integer NOT NULL,
	`operator` text NOT NULL,
	`operands` text NOT NULL,
	CONSTRAINT `fragments_pk` PRIMARY KEY(`model_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `models` (
	`id` text PRIMARY KEY,
	`revision` integer NOT NULL,
	`views` text
);
--> statement-breakpoint
CREATE TABLE `overlay` (
	`model_id` text NOT NULL,
	`element` text NOT NULL,
	`status` text NOT NULL,
	CONSTRAINT `overlay_pk` PRIMARY KEY(`model_id`, `element`)
);
--> statement-breakpoint
CREATE TABLE `participants` (
	`model_id` text NOT NULL,
	`id` text NOT NULL,
	`position` integer NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	CONSTRAINT `participants_pk` PRIMARY KEY(`model_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `projections` (
	`model_id` text NOT NULL,
	`position` integer NOT NULL,
	`id` text NOT NULL,
	`notation` text NOT NULL,
	`subject` text,
	`scenario` text,
	CONSTRAINT `projections_pk` PRIMARY KEY(`model_id`, `position`)
);
--> statement-breakpoint
CREATE TABLE `sequences` (
	`name` text PRIMARY KEY,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transitions` (
	`model_id` text NOT NULL,
	`id` text NOT NULL,
	`position` integer NOT NULL,
	`source` text NOT NULL,
	`target` text NOT NULL,
	`trigger` text,
	`guard` text,
	`condition` text,
	`effect` text,
	`loop` integer NOT NULL,
	CONSTRAINT `transitions_pk` PRIMARY KEY(`model_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `transitions_by_target` ON `transitions` (`model_id`,`target`);--> statement-breakpoint
CREATE INDEX `transitions_by_source` ON `transitions` (`model_id`,`source`);