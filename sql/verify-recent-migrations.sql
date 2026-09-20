-- =============================================================================
-- Verify recent migrations
-- =============================================================================
-- Run this in the Supabase SQL editor and look at the results table. Every
-- row should say "true" — if any row says "false", that one file didn't
-- finish running (or hasn't been run at all) and needs a re-run.
--
-- This checks the four most recent migrations:
--   product-tag.sql             -> media.product_tag column
--   approved-gear-items.sql     -> approved_gear_items table + gear-photos bucket
--   quote-voiceover-library.sql -> quotes + quote_recordings tables + quote-voices bucket
--   reports-and-blocks.sql      -> reports table + blocked_users table
-- =============================================================================

select 'media.product_tag column (product-tag.sql)' as check_name,
       exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'media' and column_name = 'product_tag'
       ) as exists

union all

select 'approved_gear_items table (approved-gear-items.sql)',
       exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'approved_gear_items'
       )

union all

select 'gear-photos storage bucket (approved-gear-items.sql)',
       exists (select 1 from storage.buckets where id = 'gear-photos')

union all

select 'quotes table (quote-voiceover-library.sql)',
       exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'quotes'
       )

union all

select 'quote_recordings table (quote-voiceover-library.sql)',
       exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'quote_recordings'
       )

union all

select 'quote-voices storage bucket (quote-voiceover-library.sql)',
       exists (select 1 from storage.buckets where id = 'quote-voices')

union all

select 'reports table (reports-and-blocks.sql)',
       exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'reports'
       )

union all

select 'blocked_users table (reports-and-blocks.sql)',
       exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'blocked_users'
       );
