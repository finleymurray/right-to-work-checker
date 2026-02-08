-- ============================================================
-- ImmersiveCore RTW Checker — Authentication & Audit Setup
-- Run this in the Supabase SQL Editor after the base schema.
-- ============================================================

-- 1. Profiles table (linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('manager', 'staff')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Audit log table
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  user_email TEXT,
  action TEXT NOT NULL,
  table_name TEXT,
  record_id UUID,
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

-- 3. Add created_by column to rtw_records
ALTER TABLE rtw_records ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);

-- 4. Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'staff')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5. Audit log trigger for rtw_records
CREATE OR REPLACE FUNCTION public.audit_rtw_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (user_id, user_email, action, table_name, record_id, new_values)
    VALUES (
      auth.uid(),
      (SELECT email FROM profiles WHERE id = auth.uid()),
      'create', 'rtw_records', NEW.id, to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_log (user_id, user_email, action, table_name, record_id, old_values, new_values)
    VALUES (
      auth.uid(),
      (SELECT email FROM profiles WHERE id = auth.uid()),
      'update', 'rtw_records', NEW.id, to_jsonb(OLD), to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log (user_id, user_email, action, table_name, record_id, old_values)
    VALUES (
      auth.uid(),
      (SELECT email FROM profiles WHERE id = auth.uid()),
      'delete', 'rtw_records', OLD.id, to_jsonb(OLD)
    );
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS rtw_records_audit ON rtw_records;
CREATE TRIGGER rtw_records_audit
  AFTER INSERT OR UPDATE OR DELETE ON rtw_records
  FOR EACH ROW EXECUTE FUNCTION public.audit_rtw_changes();

-- 6. Enable Row Level Security
ALTER TABLE rtw_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- 7. Helper function for role checks (avoids infinite recursion in RLS policies)
CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'manager'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 8. RLS Policies — rtw_records
-- Remove any legacy wide-open policies first
DROP POLICY IF EXISTS "Allow all access" ON rtw_records;
DROP POLICY IF EXISTS "strict_view_policy" ON rtw_records;
DROP POLICY IF EXISTS "strict_update_policy" ON rtw_records;
DROP POLICY IF EXISTS "strict_insert_policy" ON rtw_records;
DROP POLICY IF EXISTS "strict_delete_policy" ON rtw_records;

-- Staff see only their own records; managers see all.
DROP POLICY IF EXISTS "auth_select_records" ON rtw_records;
CREATE POLICY "auth_select_records"
  ON rtw_records FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.is_manager());

-- Anyone authenticated can insert (created_by is set in app code).
DROP POLICY IF EXISTS "auth_insert_records" ON rtw_records;
CREATE POLICY "auth_insert_records"
  ON rtw_records FOR INSERT TO authenticated WITH CHECK (true);

-- Staff can only update their own records; managers can update all.
DROP POLICY IF EXISTS "auth_update_records" ON rtw_records;
CREATE POLICY "auth_update_records"
  ON rtw_records FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.is_manager());

-- Only managers can delete.
DROP POLICY IF EXISTS "manager_delete_records" ON rtw_records;
CREATE POLICY "manager_delete_records"
  ON rtw_records FOR DELETE TO authenticated
  USING (public.is_manager());

-- 8. RLS Policies — profiles
DROP POLICY IF EXISTS "users_read_own_profile" ON profiles;
CREATE POLICY "users_read_own_profile"
  ON profiles FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS "managers_read_all_profiles" ON profiles;
CREATE POLICY "managers_read_all_profiles"
  ON profiles FOR SELECT TO authenticated
  USING (public.is_manager());

DROP POLICY IF EXISTS "users_update_own_profile" ON profiles;
CREATE POLICY "users_update_own_profile"
  ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 9. RLS Policies — audit_log
DROP POLICY IF EXISTS "managers_read_audit" ON audit_log;
CREATE POLICY "managers_read_audit"
  ON audit_log FOR SELECT TO authenticated
  USING (public.is_manager());

DROP POLICY IF EXISTS "auth_insert_audit" ON audit_log;
CREATE POLICY "auth_insert_audit"
  ON audit_log FOR INSERT TO authenticated WITH CHECK (true);

-- 10. Storage policies for document-scans bucket

-- Create the bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('document-scans', 'document-scans', false)
ON CONFLICT (id) DO NOTHING;

-- Helper: check if the current user owns the record that a scan belongs to.
-- Storage paths are "recordId/filename", so the first path segment is the record UUID.
CREATE OR REPLACE FUNCTION public.owns_scan(object_name TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rtw_records
    WHERE id = (split_part(object_name, '/', 1))::uuid
      AND created_by = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Staff can upload scans for their own records; managers can upload for any.
DROP POLICY IF EXISTS "auth_upload_scans" ON storage.objects;
CREATE POLICY "auth_upload_scans"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'document-scans'
    AND (public.owns_scan(name) OR public.is_manager())
  );

-- Staff can read scans for their own records; managers can read all.
DROP POLICY IF EXISTS "auth_read_scans" ON storage.objects;
CREATE POLICY "auth_read_scans"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'document-scans'
    AND (public.owns_scan(name) OR public.is_manager())
  );

-- Staff can update scans for their own records; managers can update all.
DROP POLICY IF EXISTS "auth_update_scans" ON storage.objects;
CREATE POLICY "auth_update_scans"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'document-scans'
    AND (public.owns_scan(name) OR public.is_manager())
  );

-- Only managers can delete scans (matches record deletion being manager-only).
DROP POLICY IF EXISTS "auth_delete_scans" ON storage.objects;
CREATE POLICY "auth_delete_scans"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'document-scans'
    AND public.is_manager()
  );

-- ============================================================
-- 11. GDPR Retention — employment end date + deleted records log
-- ============================================================

-- Add employment_end_date and deletion_due_date to rtw_records
ALTER TABLE rtw_records ADD COLUMN IF NOT EXISTS employment_end_date DATE;
ALTER TABLE rtw_records ADD COLUMN IF NOT EXISTS deletion_due_date DATE;

-- Table to log deleted records (GDPR-compliant: no personal data kept)
CREATE TABLE IF NOT EXISTS deleted_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_record_id UUID NOT NULL,
  person_name TEXT NOT NULL,
  employment_start_date DATE,
  employment_end_date DATE,
  deletion_due_date DATE,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_by UUID REFERENCES auth.users(id),
  deleted_by_email TEXT,
  reason TEXT NOT NULL DEFAULT 'GDPR retention period expired'
);

CREATE INDEX IF NOT EXISTS idx_deleted_records_deleted_at ON deleted_records(deleted_at DESC);

-- RLS for deleted_records
ALTER TABLE deleted_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "managers_read_deleted" ON deleted_records;
CREATE POLICY "managers_read_deleted"
  ON deleted_records FOR SELECT TO authenticated
  USING (public.is_manager());

DROP POLICY IF EXISTS "managers_insert_deleted" ON deleted_records;
CREATE POLICY "managers_insert_deleted"
  ON deleted_records FOR INSERT TO authenticated
  WITH CHECK (public.is_manager());
