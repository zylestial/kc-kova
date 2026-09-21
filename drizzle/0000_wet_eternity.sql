CREATE TABLE `vehicle_records` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`plate_key` text NOT NULL,
	`driver_key` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicle_day` ON `vehicle_records` (`date`,`plate_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `driver_day` ON `vehicle_records` (`date`,`driver_key`);