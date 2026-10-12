import {sqliteTable,text,integer} from 'drizzle-orm/sqlite-core';
export const bookingAttempts=sqliteTable('booking_attempts',{
  offerId:text('offer_id').primaryKey(),
  intentId:text('intent_id').notNull().unique(),
  state:text('state').notNull(),
  receipt:text('receipt'),
  createdAt:integer('created_at').notNull()
});
