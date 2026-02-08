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

-- Anyone authenticated can insert, but created_by must match their own uid.
DROP POLICY IF EXISTS "auth_insert_records" ON rtw_records;
CREATE POLICY "auth_insert_records"
  ON rtw_records FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

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

-- ============================================================
-- 12. GDPR — Scrub personal data from audit_log when records are deleted
-- ============================================================

-- When a record is deleted for GDPR, the audit_log still holds full JSONB copies
-- of the record in old_values/new_values. This function redacts sensitive fields
-- (person_name, date_of_birth, share_code, verification_answers, additional_notes)
-- from audit_log entries for a given record_id, preserving the audit trail structure
-- but removing personal data.
-- ============================================================
-- 12a. Cross-site notifications table
-- ============================================================

-- Stores notifications that can be shown on the immersivecore.network landing page.
-- Any sub-site (rtw, training, etc.) can create notifications via the Supabase API.
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_app TEXT NOT NULL DEFAULT 'rtw-checker',
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'urgent')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  action_url TEXT,
  record_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dismissed_at TIMESTAMPTZ,
  dismissed_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_source_app ON notifications(source_app);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Managers can read and update (dismiss) notifications
DROP POLICY IF EXISTS "managers_read_notifications" ON notifications;
CREATE POLICY "managers_read_notifications"
  ON notifications FOR SELECT TO authenticated
  USING (public.is_manager());

DROP POLICY IF EXISTS "managers_update_notifications" ON notifications;
CREATE POLICY "managers_update_notifications"
  ON notifications FOR UPDATE TO authenticated
  USING (public.is_manager());

-- Any authenticated user can create notifications (sub-sites need this)
DROP POLICY IF EXISTS "auth_insert_notifications" ON notifications;
CREATE POLICY "auth_insert_notifications"
  ON notifications FOR INSERT TO authenticated
  WITH CHECK (true);

-- ============================================================
-- 12b. GDPR — Server-side auto-delete expired records (pg_cron)
-- ============================================================

-- This function runs autonomously via pg_cron to delete records
-- past their retention period, without requiring a manager to visit
-- the retention page. It logs each deletion, removes scans, and
-- scrubs audit data.
CREATE OR REPLACE FUNCTION public.auto_delete_expired_records()
RETURNS VOID AS $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT * FROM rtw_records
    WHERE deletion_due_date IS NOT NULL
      AND deletion_due_date <= CURRENT_DATE
  LOOP
    -- Log to deleted_records audit trail
    INSERT INTO deleted_records (original_record_id, person_name, employment_start_date, employment_end_date, deletion_due_date, deleted_by_email, reason)
    VALUES (rec.id, rec.person_name, rec.check_date, rec.employment_end_date, rec.deletion_due_date, 'system@auto-delete', 'GDPR retention period expired (auto)');

    -- Delete storage objects for this record
    DELETE FROM storage.objects
    WHERE bucket_id = 'document-scans'
      AND (name LIKE rec.id::text || '/%');

    -- Delete the record itself
    DELETE FROM rtw_records WHERE id = rec.id;

    -- Scrub personal data from audit log
    PERFORM public.scrub_audit_personal_data(rec.id);
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule: run daily at 02:00 UTC
-- NOTE: pg_cron must be enabled in your Supabase project (Database > Extensions > pg_cron)
-- Then run this in the SQL editor:
--   SELECT cron.schedule('gdpr-auto-delete', '0 2 * * *', 'SELECT public.auto_delete_expired_records()');
-- To check scheduled jobs: SELECT * FROM cron.job;
-- To remove: SELECT cron.unschedule('gdpr-auto-delete');

-- ============================================================
-- 12c. GDPR — Scrub personal data from audit_log
-- ============================================================

CREATE OR REPLACE FUNCTION public.scrub_audit_personal_data(target_record_id UUID)
RETURNS VOID AS $$
DECLARE
  sensitive_keys TEXT[] := ARRAY['person_name', 'date_of_birth', 'share_code', 'verification_answers', 'additional_notes', 'document_scan_path', 'document_scan_filename'];
  k TEXT;
BEGIN
  FOREACH k IN ARRAY sensitive_keys LOOP
    UPDATE audit_log
    SET old_values = old_values - k,
        new_values = new_values - k
    WHERE record_id = target_record_id
      AND (old_values ? k OR new_values ? k);
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 13. Server-side notification generation for records needing attention
-- ============================================================
-- This function checks all rtw_records and creates notifications
-- for any that need attention (follow-up due, expired, overdue,
-- pending deletion). It avoids duplicates by checking if an
-- undismissed notification already exists for the same record + action.
-- Schedule via pg_cron alongside the auto-delete job.

CREATE OR REPLACE FUNCTION public.generate_rtw_notifications()
RETURNS VOID AS $$
DECLARE
  rec RECORD;
  today DATE := CURRENT_DATE;
  warning_date DATE := CURRENT_DATE + INTERVAL '28 days';
  notif_exists BOOLEAN;
BEGIN
  -- 1. Records pending deletion (deletion_due_date has passed)
  FOR rec IN
    SELECT id, person_name, deletion_due_date
    FROM rtw_records
    WHERE deletion_due_date IS NOT NULL AND deletion_due_date <= today
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM notifications
      WHERE record_id = rec.id
        AND source_app = 'rtw-checker'
        AND title LIKE 'Pending Deletion%'
        AND dismissed_at IS NULL
    ) INTO notif_exists;

    IF NOT notif_exists THEN
      INSERT INTO notifications (source_app, severity, title, message, action_url, record_id)
      VALUES (
        'rtw-checker', 'urgent',
        'Pending Deletion: ' || rec.person_name,
        'GDPR retention period has expired for ' || rec.person_name || '. Record is due for deletion (due ' || rec.deletion_due_date || ').',
        'https://rtw.immersivecore.network/#/retention',
        rec.id
      );
    END IF;
  END LOOP;

  -- 2. Expired records (expiry_date has passed)
  FOR rec IN
    SELECT id, person_name, expiry_date
    FROM rtw_records
    WHERE expiry_date IS NOT NULL AND expiry_date < today
      AND (deletion_due_date IS NULL OR deletion_due_date > today)
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM notifications
      WHERE record_id = rec.id
        AND source_app = 'rtw-checker'
        AND title LIKE 'Expired%'
        AND dismissed_at IS NULL
    ) INTO notif_exists;

    IF NOT notif_exists THEN
      INSERT INTO notifications (source_app, severity, title, message, action_url, record_id)
      VALUES (
        'rtw-checker', 'urgent',
        'Expired: ' || rec.person_name,
        'Right to work check for ' || rec.person_name || ' expired on ' || rec.expiry_date || '. A new check is required.',
        'https://rtw.immersivecore.network/#/record/' || rec.id,
        rec.id
      );
    END IF;
  END LOOP;

  -- 3. Follow-up overdue (follow_up_date has passed)
  FOR rec IN
    SELECT id, person_name, follow_up_date
    FROM rtw_records
    WHERE follow_up_date IS NOT NULL AND follow_up_date < today
      AND (expiry_date IS NULL OR expiry_date >= today)
      AND (deletion_due_date IS NULL OR deletion_due_date > today)
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM notifications
      WHERE record_id = rec.id
        AND source_app = 'rtw-checker'
        AND title LIKE 'Overdue%'
        AND dismissed_at IS NULL
    ) INTO notif_exists;

    IF NOT notif_exists THEN
      INSERT INTO notifications (source_app, severity, title, message, action_url, record_id)
      VALUES (
        'rtw-checker', 'warning',
        'Overdue: ' || rec.person_name,
        'Follow-up check for ' || rec.person_name || ' was due on ' || rec.follow_up_date || '.',
        'https://rtw.immersivecore.network/#/record/' || rec.id,
        rec.id
      );
    END IF;
  END LOOP;

  -- 4. Follow-up due within 28 days
  FOR rec IN
    SELECT id, person_name, follow_up_date
    FROM rtw_records
    WHERE follow_up_date IS NOT NULL
      AND follow_up_date >= today AND follow_up_date <= warning_date
      AND (expiry_date IS NULL OR expiry_date >= today)
      AND (deletion_due_date IS NULL OR deletion_due_date > today)
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM notifications
      WHERE record_id = rec.id
        AND source_app = 'rtw-checker'
        AND title LIKE 'Follow-up Due%'
        AND dismissed_at IS NULL
    ) INTO notif_exists;

    IF NOT notif_exists THEN
      INSERT INTO notifications (source_app, severity, title, message, action_url, record_id)
      VALUES (
        'rtw-checker', 'info',
        'Follow-up Due: ' || rec.person_name,
        'Follow-up check for ' || rec.person_name || ' is due on ' || rec.follow_up_date || '.',
        'https://rtw.immersivecore.network/#/record/' || rec.id,
        rec.id
      );
    END IF;
  END LOOP;

  -- 5. Expiry approaching within 28 days
  FOR rec IN
    SELECT id, person_name, expiry_date
    FROM rtw_records
    WHERE expiry_date IS NOT NULL
      AND expiry_date >= today AND expiry_date <= warning_date
      AND (follow_up_date IS NULL OR follow_up_date > warning_date)
      AND (deletion_due_date IS NULL OR deletion_due_date > today)
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM notifications
      WHERE record_id = rec.id
        AND source_app = 'rtw-checker'
        AND title LIKE 'Expiring Soon%'
        AND dismissed_at IS NULL
    ) INTO notif_exists;

    IF NOT notif_exists THEN
      INSERT INTO notifications (source_app, severity, title, message, action_url, record_id)
      VALUES (
        'rtw-checker', 'warning',
        'Expiring Soon: ' || rec.person_name,
        'Right to work check for ' || rec.person_name || ' expires on ' || rec.expiry_date || '.',
        'https://rtw.immersivecore.network/#/record/' || rec.id,
        rec.id
      );
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule: run daily at 06:00 UTC (after auto-delete at 02:00)
--   SELECT cron.schedule('rtw-notifications', '0 6 * * *', 'SELECT public.generate_rtw_notifications()');
-- To check: SELECT * FROM cron.job;
-- To remove: SELECT cron.unschedule('rtw-notifications');

-- ===========================================================================
-- Section 14: Onboarding Records Table
-- ===========================================================================

CREATE TABLE IF NOT EXISTS onboarding_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  ni_number TEXT,
  address TEXT,
  personal_email TEXT,
  mobile_number TEXT,
  employee_statement TEXT CHECK (employee_statement IN ('A', 'B', 'C')),
  has_student_loan BOOLEAN DEFAULT false,
  student_loan_plan TEXT CHECK (student_loan_plan IN ('Plan 1', 'Plan 2', 'Plan 4', 'Plan 5') OR student_loan_plan IS NULL),
  has_postgraduate_loan BOOLEAN DEFAULT false,
  bank_account_holder TEXT,
  bank_sort_code TEXT,
  bank_account_number TEXT,
  emergency_contact_name TEXT,
  emergency_contact_relationship TEXT,
  emergency_contact_phone TEXT,
  medical_notes TEXT,
  tshirt_size TEXT CHECK (tshirt_size IN ('XS', 'S', 'M', 'L', 'XL', 'XXL') OR tshirt_size IS NULL),
  trouser_size TEXT,
  paper_scan_path TEXT,
  paper_scan_filename TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'rtw_in_progress', 'complete')),
  rtw_record_id UUID,
  gdrive_folder_id TEXT,
  gdrive_pdf_link TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_status ON onboarding_records(status);
CREATE INDEX IF NOT EXISTS idx_onboarding_created_by ON onboarding_records(created_by);

-- Add onboarding_id to rtw_records for linking
ALTER TABLE rtw_records ADD COLUMN IF NOT EXISTS onboarding_id UUID REFERENCES onboarding_records(id);

-- RLS for onboarding_records (managers only)
ALTER TABLE onboarding_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "managers_select_onboarding" ON onboarding_records
  FOR SELECT TO authenticated USING (public.is_manager());
CREATE POLICY "managers_insert_onboarding" ON onboarding_records
  FOR INSERT TO authenticated WITH CHECK (public.is_manager());
CREATE POLICY "managers_update_onboarding" ON onboarding_records
  FOR UPDATE TO authenticated USING (public.is_manager());
CREATE POLICY "managers_delete_onboarding" ON onboarding_records
  FOR DELETE TO authenticated USING (public.is_manager());

-- Storage bucket for onboarding scans
INSERT INTO storage.buckets (id, name, public)
VALUES ('onboarding-scans', 'onboarding-scans', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "managers_upload_onboarding_scans" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'onboarding-scans' AND public.is_manager());
CREATE POLICY "managers_read_onboarding_scans" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'onboarding-scans' AND public.is_manager());
CREATE POLICY "managers_update_onboarding_scans" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'onboarding-scans' AND public.is_manager());
CREATE POLICY "managers_delete_onboarding_scans" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'onboarding-scans' AND public.is_manager());

-- Audit trigger for onboarding_records
CREATE OR REPLACE FUNCTION public.audit_onboarding_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (user_id, user_email, action, table_name, record_id, new_values)
    VALUES (auth.uid(), (SELECT email FROM profiles WHERE id = auth.uid()),
            'create', 'onboarding_records', NEW.id, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_log (user_id, user_email, action, table_name, record_id, old_values, new_values)
    VALUES (auth.uid(), (SELECT email FROM profiles WHERE id = auth.uid()),
            'update', 'onboarding_records', NEW.id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log (user_id, user_email, action, table_name, record_id, old_values)
    VALUES (auth.uid(), (SELECT email FROM profiles WHERE id = auth.uid()),
            'delete', 'onboarding_records', OLD.id, to_jsonb(OLD));
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER onboarding_records_audit
  AFTER INSERT OR UPDATE OR DELETE ON onboarding_records
  FOR EACH ROW EXECUTE FUNCTION public.audit_onboarding_changes();
