-- Profile/cover image storage
--
-- The mobile app's Edit Profile photo picker and Profile's cover-photo
-- picker were session-only (a local ValueNotifier, no upload target) —
-- picks looked saved but vanished on app restart, since nothing ever wrote
-- them anywhere durable. This adds a public storage bucket for them, keyed
-- to each user's own folder so RLS can restrict writes to your own images
-- while keeping them readable by anyone (needed for friends to see your
-- avatar in the Friends/Activity feed).
--
-- Requires 002 (needs public.profiles, whose avatar_url/cover_url columns
-- already exist and just weren't being written to). Idempotent.

insert into storage.buckets (id, name, public)
values ('profile-images', 'profile-images', true)
on conflict (id) do nothing;

drop policy if exists "profile images are publicly readable" on storage.objects;
create policy "profile images are publicly readable"
    on storage.objects for select
    using (bucket_id = 'profile-images');

drop policy if exists "users can upload their own profile images" on storage.objects;
create policy "users can upload their own profile images"
    on storage.objects for insert
    with check (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users can update their own profile images" on storage.objects;
create policy "users can update their own profile images"
    on storage.objects for update
    using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users can delete their own profile images" on storage.objects;
create policy "users can delete their own profile images"
    on storage.objects for delete
    using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);
