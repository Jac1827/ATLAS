create policy "atlas communities scoped read"
on atlas_communities for select to authenticated
using (
  deleted_at is null
  and (
    atlas_has_role(array['admin','executive','people'])
    or atlas_can_access_community(community_id)
  )
);

create policy "atlas community aliases scoped read"
on atlas_community_aliases for select to authenticated
using (
  active is true
  and exists (
    select 1 from atlas_communities c
    where c.community_id = atlas_community_aliases.community_id
      and c.deleted_at is null
      and (atlas_has_role(array['admin','executive','people']) or atlas_can_access_community(c.community_id))
  )
);

create policy "atlas roles active user read"
on atlas_roles for select to authenticated
using (active is true and atlas_current_role() <> 'anonymous');

create policy "atlas employees scoped read"
on atlas_employees for select to authenticated
using (
  deleted_at is null
  and (
    atlas_has_role(array['admin','executive','people'])
    or exists (
      select 1
      from atlas_employee_assignments a
      where a.employee_id = atlas_employees.employee_id
        and a.deleted_at is null
        and atlas_can_access_community(a.community_id)
    )
  )
);

create policy "atlas assignments scoped read"
on atlas_employee_assignments for select to authenticated
using (
  deleted_at is null
  and (
    atlas_has_role(array['admin','executive','people'])
    or atlas_can_access_community(community_id)
  )
);

create policy "atlas people owners write employees"
on atlas_employees for all to authenticated
using (atlas_has_role(array['admin','people']))
with check (atlas_has_role(array['admin','people']));

create policy "atlas people owners write assignments"
on atlas_employee_assignments for all to authenticated
using (atlas_has_role(array['admin','people']))
with check (atlas_has_role(array['admin','people']));

create policy "atlas budgets scoped read"
on atlas_budget_lines for select to authenticated
using (
  deleted_at is null
  and (
    atlas_has_role(array['admin','executive','finance'])
    or atlas_can_access_community(community_id)
  )
);

create policy "atlas finance writes budgets"
on atlas_budget_lines for all to authenticated
using (atlas_has_role(array['admin','finance']) and atlas_can_access_community(community_id))
with check (atlas_has_role(array['admin','finance']) and atlas_can_access_community(community_id));

create policy "atlas actuals scoped read"
on atlas_actual_lines for select to authenticated
using (
  deleted_at is null
  and (
    atlas_has_role(array['admin','executive','finance'])
    or atlas_can_access_community(community_id)
  )
);

create policy "atlas finance writes actuals"
on atlas_actual_lines for all to authenticated
using (atlas_has_role(array['admin','finance']) and atlas_can_access_community(community_id))
with check (atlas_has_role(array['admin','finance']) and atlas_can_access_community(community_id));

create policy "atlas contracts scoped read"
on atlas_contracts for select to authenticated
using (
  deleted_at is null
  and (
    atlas_has_role(array['admin','executive','finance','maintenance'])
    or atlas_can_access_community(community_id)
  )
);

create policy "atlas finance maintenance write contracts"
on atlas_contracts for all to authenticated
using (atlas_has_role(array['admin','finance','maintenance']) and atlas_can_access_community(community_id))
with check (atlas_has_role(array['admin','finance','maintenance']) and atlas_can_access_community(community_id));
