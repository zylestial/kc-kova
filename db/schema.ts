import {sqliteTable,text,uniqueIndex} from 'drizzle-orm/sqlite-core';
export const vehicleRecords=sqliteTable('vehicle_records',{id:text('id').primaryKey(),date:text('date').notNull(),plateKey:text('plate_key').notNull(),driverKey:text('driver_key').notNull(),data:text('data').notNull()},table=>[uniqueIndex('vehicle_day').on(table.date,table.plateKey)]);
export const fleet=sqliteTable('fleet',{plate:text('plate').primaryKey(),name:text('name').notNull(),status:text('status').notNull().default('Active')});
export const bookings=sqliteTable('bookings',{id:text('id').primaryKey(),date:text('date').notNull(),plate:text('plate').notNull(),driver:text('driver').notNull(),data:text('data').notNull()});
export const bookingSlots=sqliteTable('booking_slots',{bookingId:text('booking_id').notNull(),date:text('date').notNull(),plate:text('plate').notNull(),driver:text('driver').notNull(),hour:text('hour').notNull()},t=>[uniqueIndex('vehicle_hour').on(t.date,t.plate,t.hour),uniqueIndex('driver_hour').on(t.date,t.driver,t.hour)]);
export const accounts=sqliteTable('accounts',{id:text('id').primaryKey(),name:text('name').notNull(),username:text('username').notNull().unique(),passwordHash:text('password_hash').notNull(),role:text('role').notNull(),status:text('status').notNull()});
export const sessions=sqliteTable('sessions',{tokenHash:text('token_hash').primaryKey(),accountId:text('account_id').notNull(),expiresAt:text('expires_at').notNull()});
export const loginAttempts=sqliteTable('login_attempts',{key:text('key').primaryKey(),count:text('count').notNull(),windowStart:text('window_start').notNull()});
export const vehicleAliases=sqliteTable('vehicle_aliases',{oldPlate:text('old_plate').primaryKey(),newPlate:text('new_plate').notNull()});
