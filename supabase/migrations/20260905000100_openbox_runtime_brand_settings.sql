-- Promote legacy upstream visual defaults to the Open-Box production identity.
-- Preserve any administrator-customized values by updating exact legacy values only.

update public.x_setting_items
set value = 'https://open-box.space/open-box-brand.svg'
where key in ('logo', 'favicon')
  and value in (
    'https://res.oplist.org/logo/logo.svg',
    'https://cdn.oplist.org/gh/OpenListTeam/Logo@main/logo.svg'
  );

update public.x_setting_items
set value = '#7c3aed'
where key = 'main_color'
  and value = '#1890ff';
