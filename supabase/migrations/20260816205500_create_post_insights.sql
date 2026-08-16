create table public.post_insights (
    id uuid primary key default gen_random_uuid(),
    post_id uuid references public.scheduled_posts(id) on delete cascade not null,
    impressions bigint default 0,
    reach bigint default 0,
    likes bigint default 0,
    comments bigint default 0,
    shares bigint default 0,
    saves bigint default 0,
    views bigint default 0,
    platform_data jsonb default '{}'::jsonb,
    fetched_at timestamp with time zone default now(),
    unique (post_id)
);

grant select, insert, update on public.post_insights to authenticated;
grant all on public.post_insights to service_role;

alter table public.post_insights enable row level security;

create policy "Users can view insights for their own posts"
on public.post_insights
for select
to authenticated
using (
    exists (
        select 1 from public.scheduled_posts
        where scheduled_posts.id = post_insights.post_id
        and scheduled_posts.user_id = auth.uid()
    )
);
