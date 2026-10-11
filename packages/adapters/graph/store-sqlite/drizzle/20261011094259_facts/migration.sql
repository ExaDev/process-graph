CREATE TABLE `artefact_facts` (
	`model_id` text NOT NULL,
	`artefact` text NOT NULL,
	`provided` integer NOT NULL,
	CONSTRAINT `artefact_facts_pk` PRIMARY KEY(`model_id`, `artefact`)
);
--> statement-breakpoint
CREATE TABLE `named_facts` (
	`model_id` text NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT `named_facts_pk` PRIMARY KEY(`model_id`, `name`)
);
