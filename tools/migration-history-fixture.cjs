// Local PostgreSQL-compatible history replay, with explicitly documented platform emulation.
const fs = require('node:fs');
const path = require('node:path');
const {PGlite} = require('@electric-sql/pglite');
const root = path.join(__dirname, '..');

async function migrationHistoryFixture({includeLater = false, legacyBootstrap = true} = {}) {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create schema extensions;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',email_confirmed_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now(),invited_at timestamptz,confirmation_sent_at timestamptz,recovery_sent_at timestamptz,last_sign_in_at timestamptz);
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),auth.jwt()->>'sub')::uuid$$;
      grant usage on schema public,auth,extensions to anon,authenticated,service_role;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
      alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
      create function extensions.digest(value text,algorithm text) returns bytea language plpgsql immutable as $$begin if algorithm<>'sha256' then raise exception 'Fixture only supports SHA256';end if;return sha256(convert_to(value,'UTF8'));end;$$;
      create function extensions.digest(value bytea,algorithm text) returns bytea language plpgsql immutable as $$begin if algorithm<>'sha256' then raise exception 'Fixture only supports SHA256';end if;return sha256(value);end;$$;
      create function public.digest(value text,algorithm text) returns bytea language sql immutable as $$select extensions.digest(value,algorithm)$$;
      create function public.digest(value bytea,algorithm text) returns bytea language sql immutable as $$select extensions.digest(value,algorithm)$$;
    `);
    if (legacyBootstrap) await db.exec(fs.readFileSync(path.join(__dirname, 'fixtures/atlas-legacy-state-store-bootstrap.sql'), 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'supabase/migration-history.json'), 'utf8'));
    const migrations = includeLater
      ? fs.readdirSync(path.join(root, 'supabase/migrations')).filter(file => /^\d{14}_[a-z0-9_]+\.sql$/.test(file)).sort()
      : manifest.records.map(record => record.file);
    for (const file of migrations) {
      const sql = fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8');
      try {
        // PGlite lacks pgcrypto. Managed Supabase supplies it; only its extension declaration is skipped.
        await db.exec(sql.replace(/create extension if not exists pgcrypto;/gi, ''));
      } catch (error) {
        error.migrationFile = file;
        throw error;
      }
    }
    return {db, migrations};
  } catch (error) { await db.close(); throw error; }
}
module.exports = {migrationHistoryFixture};
