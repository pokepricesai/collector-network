-- CN-05B close-out: correct the 20-task ledger per operator feedback.
--
-- Reasoning:
--   • SearchAction sitelinks search box is deprecated by Google
--     (announced Oct 2024). Task 17 removed outright.
--   • Pure cosmetic BreadcrumbList / aria-label tasks are not SEO
--     growth levers at this stage. Downgraded to 'low'.
--   • A page sitting at position 30–50 is a ranking problem, not a
--     meta-description problem — rewriting the snippet moves CTR
--     at most by a few percent, which is unmeasurable when
--     impressions are in the 100–300 range. Task 7 rewritten.
--   • Link-count-for-sake-of-count explicitly cautioned against,
--     so the "raise sibling cap 12 → 36" is downgraded.

-- 1. Dismiss SearchAction task (deprecated feature)
update public.network_tasks
   set status = 'dismissed',
       completed_at = now(),
       metadata = metadata || jsonb_build_object(
         'dismissed_reason',
         'SearchAction sitelinks search box deprecated by Google 2024-10; emitting the schema no longer earns the rich result.'
       )
 where metadata->>'sprint' = 'CN-05B'
   and metadata->>'task_num' = '17';

-- 2. Downgrade BreadcrumbList / aria-label (cosmetic, not growth)
update public.network_tasks
   set priority = 'low',
       metadata = metadata || jsonb_build_object(
         'downgrade_reason',
         'BreadcrumbList + aria-label are cosmetic / a11y hygiene. Keep in backlog but do not block growth work.'
       )
 where metadata->>'sprint' = 'CN-05B'
   and metadata->>'task_num' in ('14', '15', '16');

-- 3. Reframe YGO most-valuable-yugioh-cards (task 7): CTR at pos 46
--    is not a meta-desc fix. The real lever is article depth +
--    specific-data integration so the page can RANK, not just
--    attract a better click when it finally does.
update public.network_tasks
   set title = 'YGO /insights/most-valuable-yugioh-cards: strengthen article depth, not just the snippet',
       description = 'Previously framed as "rewrite meta description + opener". Correction: at pos 46.4 the issue is ranking, not snippet. A page at that depth receives no clicks regardless of meta copy. Replace with concrete-data content work: integrate live top-N printings from the mostValuable homepage feed (already available), surface specific set + rarity + current price, and add a brief rarity primer. The goal is to earn a position move into the top 20, not polish the snippet.',
       recommended_action = 'Edit apps/yugioh/src/app/insights/[slug]/page.tsx MostValuableBody() to render the live top-20 with set/rarity/price. Keep meta description aligned, but do not treat the snippet as the lever.',
       metadata = metadata || jsonb_build_object(
         'reframe_reason',
         'pos 30-50 is a ranking problem; snippet rewrites are measurable only once the URL reaches page 1'
       )
 where metadata->>'sprint' = 'CN-05B'
   and metadata->>'task_num' = '7';

-- 4. Downgrade sibling-cap-12→36 (link count for the sake of count)
update public.network_tasks
   set priority = 'low',
       metadata = metadata || jsonb_build_object(
         'downgrade_reason',
         'Operator feedback: do not increase link counts for their own sake. 12 sibling sets is sufficient; more would be noise.'
       )
 where metadata->>'sprint' = 'CN-05B'
   and metadata->>'task_num' = '11';

-- 5. Add three-status tracking fields to task metadata so Deployed +
--    Verified can be distinguished from Code Complete. Existing
--    completed tasks (1-5) carry 'completed' status but need the
--    explicit breakdown.
update public.network_tasks
   set metadata = metadata || jsonb_build_object(
         'code_complete_at', completed_at,
         'deployed_at', case
           when metadata->>'task_num' in ('1','3') then '2026-10-16T09:30:00Z'  -- YGO + OP via b54af6c
           when metadata->>'task_num' in ('2','4') then '2026-10-16T09:35:00Z'  -- MTG via 224b9f77
           else null
         end,
         'verified_at', case
           when metadata->>'task_num' in ('1','2','3','4') then '2026-10-16T09:50:00Z'
           else null
         end,
         'verification_notes', case
           when metadata->>'task_num' = '1' then 'ygoprices.io/ outbound /set/* links = 24 (was 8)'
           when metadata->>'task_num' = '2' then 'mtgprices.io/ outbound /set/* links = 31 (was 1)'
           when metadata->>'task_num' = '3' then 'onepieceprices.io/ outbound /set/* links = 29'
           when metadata->>'task_num' = '4' then 'mtgprices.io/insights/* emits /browse /formats /graded /market'
           when metadata->>'task_num' = '5' then 'Code lands in b54af6c; not deployed (lorcana vercel --prod blocked on operator)'
           else null
         end
       )
 where metadata->>'sprint' = 'CN-05B'
   and metadata->>'task_num' in ('1','2','3','4','5');

-- 6. Task 5 is Code Complete but NOT Deployed → not actually
--    'completed'. Downgrade back to 'in_progress' per operator
--    instruction "Do not mark an undeployed change complete".
update public.network_tasks
   set status = 'in_progress',
       completed_at = null,
       metadata = metadata - 'deployed_at' - 'verified_at' - 'verification_notes'
         || jsonb_build_object(
           'code_complete_at', '2026-10-16T09:30:00Z',
           'blocked_on', 'lorcana vercel --prod · depends on task 6'
         )
 where metadata->>'sprint' = 'CN-05B'
   and metadata->>'task_num' = '5';

-- Verification report
select metadata->>'task_num' AS n,
       status,
       priority,
       (metadata->>'deployed_at') is not null AS deployed,
       (metadata->>'verified_at') is not null AS verified,
       title
  from public.network_tasks
 where metadata->>'sprint' = 'CN-05B'
 order by (metadata->>'task_num')::int;
