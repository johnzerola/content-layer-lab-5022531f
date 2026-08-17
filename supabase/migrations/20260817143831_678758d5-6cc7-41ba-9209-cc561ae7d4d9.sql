INSERT INTO public.user_roles (user_id, role)
VALUES ('1684c70d-7aa4-40bd-b666-d34f16e354da', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
