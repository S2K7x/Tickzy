-- 0009 (T-203, FR-4.2): remember whether a contact's account was chosen by a person. Automatic mapping
-- (email domain, endpoint default) never overrides a manual choice.
ALTER TABLE contacts ADD COLUMN account_source text NOT NULL DEFAULT 'auto' CHECK (account_source IN ('auto', 'manual'));
