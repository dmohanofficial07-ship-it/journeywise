import {sqliteTable,text,integer,index} from 'drizzle-orm/sqlite-core';
export const accounts=sqliteTable('accounts',{
  id:text('id').primaryKey(),
  provider:text('provider').notNull(),
  email:text('email').notNull(),
  name:text('name').notNull(),
  createdAt:integer('created_at').notNull()
});
export const localCredentials=sqliteTable('local_credentials',{
  email:text('email').primaryKey(),
  accountId:text('account_id').notNull().unique().references(()=>accounts.id),
  passwordHash:text('password_hash').notNull(),
  salt:text('salt').notNull()
});
export const localSessions=sqliteTable('local_sessions',{
  tokenHash:text('token_hash').primaryKey(),
  accountId:text('account_id').notNull().references(()=>accounts.id),
  expiresAt:integer('expires_at').notNull()
},table=>[index('local_sessions_expiry_idx').on(table.expiresAt)]);
export const localAuthLimits=sqliteTable('local_auth_limits',{
  key:text('key').primaryKey(),
  attempts:integer('attempts').notNull(),
  expiresAt:integer('expires_at').notNull()
});
export const bookingAttempts=sqliteTable('booking_attempts',{
  offerId:text('offer_id').primaryKey(),
  intentId:text('intent_id').notNull().unique(),
  state:text('state').notNull(),
  receipt:text('receipt'),
  createdAt:integer('created_at').notNull(),
  ownerId:text('owner_id').references(()=>accounts.id),
  context:text('context')
},table=>[index('booking_owner_created_idx').on(table.ownerId,table.createdAt,table.intentId)]);
