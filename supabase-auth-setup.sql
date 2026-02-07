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

-- 7. RLS Policies — rtw_records
DROP POLICY IF EXISTS "auth_select_records" ON rtw_records;
CREATE POLICY "auth_select_records"
  ON rtw_records FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_insert_records" ON rtw_records;
CREATE POLICY "auth_insert_records"
  ON rtw_records FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth_update_records" ON rtw_records;
CREATE POLICY "auth_update_records"
  ON rtw_records FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "manager_delete_records" ON rtw_records;
CREATE POLICY "manager_delete_records"
  ON rtw_records FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'manager')
  );

-- 8. RLS Policies — profiles
DROP POLICY IF EXISTS "users_read_own_profile" ON profiles;
CREATE POLICY "users_read_own_profile"
  ON profiles FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS "managers_read_all_profiles" ON profiles;
CREATE POLICY "managers_read_all_profiles"
  ON profiles FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'manager')
  );

DROP POLICY IF EXISTS "users_update_own_profile" ON profiles;
CREATE POLICY "users_update_own_profile"
  ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 9. RLS Policies — audit_log
DROP POLICY IF EXISTS "managers_read_audit" ON audit_log;
CREATE POLICY "managers_read_audit"
  ON audit_log FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'manager')
  );

DROP POLICY IF EXISTS "auth_insert_audit" ON audit_log;
CREATE POLICY "auth_insert_audit"
  ON audit_log FOR INSERT TO authenticated WITH CHECK (true);

-- 10. Storage policies for document-scans bucket
-- (Run these only if you haven't already set up storage policies)
-- Note: These use the storage schema. Adjust if your bucket policies are already configured.
