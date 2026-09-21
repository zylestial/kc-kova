CREATE TABLE `booking_slots` (
	`booking_id` text NOT NULL,
	`date` text NOT NULL,
	`plate` text NOT NULL,
	`driver` text NOT NULL,
	`hour` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicle_hour` ON `booking_slots` (`date`,`plate`,`hour`);--> statement-breakpoint
CREATE UNIQUE INDEX `driver_hour` ON `booking_slots` (`date`,`driver`,`hour`);--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`plate` text NOT NULL,
	`driver` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fleet` (
	`plate` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
DROP INDEX `driver_day`;
--> statement-breakpoint
CREATE TRIGGER same_vehicle_daily_driver BEFORE INSERT ON bookings
WHEN EXISTS (SELECT 1 FROM bookings WHERE date=NEW.date AND plate=NEW.plate AND driver<>NEW.driver)
BEGIN SELECT RAISE(ABORT, 'same daily driver required'); END;
