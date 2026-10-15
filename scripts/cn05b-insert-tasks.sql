-- CN-05B: insert the ranked top 20 SEO growth tasks.
-- source_code='manual' because the FK target set does not include
-- 'cn05b.*'; the sprint slug is preserved in metadata.sprint.

insert into public.network_tasks
  (site_id, title, description, task_type, source_code, priority, status, recommended_action, evidence, metadata)
values
-- Tier 1 · critical (Phase 4 batch)
('219e63bc-3526-47d9-aab4-057118dcd99c',
 'YGO homepage: expand set grid 8 → 24 recent sets',
 'YGO homepage currently links to 8 sets; GSC shows only 8 of 661 /set/* URLs received any impressions in 12d. Expand homepage grid to the 24 most-recently-released sets.',
 'seo', 'manual', 'critical', 'open',
 'Edit apps/yugioh/src/app/page.tsx to render 24 recent sets from listYugiohSetsForDirectory.',
 '{"source":"GSC url_daily 2026-10-01..12 slug=ygo","sets_in_sitemap":661,"sets_with_impressions":8}',
 '{"sprint":"CN-05B","batch":1,"task_num":1,"risk":"low","leverage":"high"}'),

('43a12771-b982-43c7-ae5f-5671ebd5d212',
 'MTG homepage: add "Popular sets" grid',
 'MTG homepage has 0 explicit /set/* links. Set pages drive 2,577 of 3,161 12d impressions but the homepage ranks pos 41 and offers no catalogue path.',
 'seo', 'manual', 'critical', 'open',
 'Edit mtgprices-web /src/app/page.tsx to render 24 recent MTG sets.',
 '{"source":"GSC url_daily slug=mtg 12d","homepage_outbound_set_links":0,"homepage_imp_12d":103,"homepage_pos":41.2}',
 '{"sprint":"CN-05B","batch":1,"task_num":2,"risk":"low","leverage":"high","repo":"pokepricesai/mtgprices-web"}'),

('f5267940-500b-4f1e-b17f-f49fbf605d3c',
 'OnePiece homepage: expand "Recent sets" grid to 24',
 'Homepage has 9 impressions in 12d despite /set/* driving 1,967. Boost crawl discovery of catalogue via a prominent 24-set grid.',
 'seo', 'manual', 'critical', 'open',
 'Edit apps/onepiece/src/app/page.tsx to render 24 recent sets.',
 '{"source":"GSC url_daily slug=onepiece 12d","homepage_imp_12d":9,"set_imp_12d":1967}',
 '{"sprint":"CN-05B","batch":1,"task_num":3,"risk":"low","leverage":"high"}'),

('43a12771-b982-43c7-ae5f-5671ebd5d212',
 'MTG /insights/[slug]: add "Explore more" strip',
 'Completes the CN-05A editorial interlinking pattern across all three sites. MTG article pages had no sibling-article links in body; mirror the YGO/OP strip shipped in 98cb30f.',
 'seo', 'manual', 'critical', 'open',
 'Edit mtgprices-web /src/app/insights/[slug]/page.tsx to append the Explore More section.',
 '{"source":"CN-05A pattern","mtg_outbound_links_per_article":2}',
 '{"sprint":"CN-05B","batch":1,"task_num":4,"risk":"low","leverage":"medium","repo":"pokepricesai/mtgprices-web"}'),

('56d49be5-3c7c-462a-94cb-81b93bc173df',
 'Lorcana /insights/[slug]: add "Explore more" strip',
 'Code lands in main so the next Lorcana manual deploy activates it. Mirrors CN-05A pattern. Zero live-site impact until operator runs `vercel --prod` for lorcana-web.',
 'seo', 'manual', 'critical', 'open',
 'Edit apps/lorcana/src/app/insights/[slug]/page.tsx.',
 '{"source":"CN-05A pattern","lorcana_gsc_url_daily_rows":0}',
 '{"sprint":"CN-05B","batch":1,"task_num":5,"risk":"low","leverage":"medium","blocked_on":"lorcana vercel --prod"}'),

-- Tier 2 · high
('56d49be5-3c7c-462a-94cb-81b93bc173df',
 'Lorcana: deploy main to production (11 commits behind)',
 'Lorcana production is stuck at 5e6010d (Oct 7). Missing: IndexNow key file, CN-04A pilot article in sitemap, CN-05A/B interlinking code.',
 'ops', 'manual', 'high', 'waiting',
 'Operator: swap .vercel/project.json to lorcana-web, run `vercel --prod --yes --force`, restore.',
 '{"prod_sha":"5e6010d","main_sha":"98cb30f","indexnow_404":true}',
 '{"sprint":"CN-05B","batch":2,"task_num":6,"risk":"low","leverage":"high"}'),

('219e63bc-3526-47d9-aab4-057118dcd99c',
 'YGO: improve meta description + opener on /insights/most-valuable-yugioh-cards',
 'Article ranks pos 46.4 with 109 imp / 0 clicks in 12d. Rewrite meta description with concrete numeric hook; update first paragraph to open with a specific price.',
 'seo', 'manual', 'high', 'open',
 'Edit apps/yugioh/src/lib/articles.ts + the hardcoded body in /insights/[slug]/page.tsx.',
 '{"source":"GSC url_daily 12d","imp":109,"clicks":0,"pos":46.4}',
 '{"sprint":"CN-05B","batch":2,"task_num":7,"risk":"low","leverage":"medium"}'),

('219e63bc-3526-47d9-aab4-057118dcd99c',
 'YGO /insights index: add category navigation',
 '/insights index lists articles but has no cross-navigation to /sets, /archetypes, /forbidden-limited. Articles accumulated 204 imp / 0 clicks 12d.',
 'seo', 'manual', 'high', 'open',
 'Edit apps/yugioh/src/app/insights/page.tsx.',
 '{"source":"GSC url_daily 12d","insights_imp":204,"insights_clicks":0}',
 '{"sprint":"CN-05B","batch":2,"task_num":8,"risk":"low","leverage":"medium"}'),

('f5267940-500b-4f1e-b17f-f49fbf605d3c',
 'OnePiece /insights index: add category navigation',
 'Mirror of the YGO task. 3 imp / 1 click in 12d on /insights/*.',
 'seo', 'manual', 'high', 'open',
 'Edit apps/onepiece/src/app/insights/page.tsx.',
 '{"source":"GSC url_daily 12d","insights_imp":3}',
 '{"sprint":"CN-05B","batch":2,"task_num":9,"risk":"low","leverage":"medium"}'),

('43a12771-b982-43c7-ae5f-5671ebd5d212',
 'MTG: enrich /formats/* pages with Related-format cross-links',
 '12 /formats/* URLs produced 255 imp / 0 clicks 12d at pos 33-44. Pages exist but Google ranks them weakly and users do not click.',
 'seo', 'manual', 'high', 'open',
 'Edit mtgprices-web format-page component.',
 '{"source":"GSC url_daily 12d","formats_imp":255,"formats_clicks":0,"pos":"33-44"}',
 '{"sprint":"CN-05B","batch":2,"task_num":10,"risk":"low","leverage":"medium","repo":"pokepricesai/mtgprices-web"}'),

-- Tier 3 · normal
('219e63bc-3526-47d9-aab4-057118dcd99c',
 'YGO /set/[slug]: raise sibling cap 12 → 36',
 'CN-05A shipped at 12. Bumping to 36 broadens crawl graph per set page without visual bloat.',
 'seo', 'manual', 'normal', 'open',
 'Edit buildSiblingSetGrid() in apps/yugioh/src/app/set/[slug]/page.tsx.',
 '{"source":"CN-05A live probe","current":12,"target":36}',
 '{"sprint":"CN-05B","batch":3,"task_num":11,"risk":"low","leverage":"medium"}'),

('43a12771-b982-43c7-ae5f-5671ebd5d212',
 'MTG set page sitemap: lastmod driven by actual price_updated_at',
 'Sitemap entries today use build time. Dynamic lastmod per set from most recent price refresh signals fresher pages to Google.',
 'seo', 'manual', 'normal', 'open',
 'Edit mtgprices-web /src/app/sitemap-sets.xml/route.ts.',
 '{"source":"MTG sitemap audit"}',
 '{"sprint":"CN-05B","batch":3,"task_num":12,"risk":"low","leverage":"low","repo":"pokepricesai/mtgprices-web"}'),

('219e63bc-3526-47d9-aab4-057118dcd99c',
 'YGO + OnePiece: Prev/Next set navigation on /set/[slug]',
 'Users and Googlebot benefit from 1-hop prev/next by release date. Complements CN-05A sibling grid.',
 'seo', 'manual', 'normal', 'open',
 'Edit set/[slug]/page.tsx on both sites.',
 '{"source":"CN-05A audit"}',
 '{"sprint":"CN-05B","batch":3,"task_num":13,"risk":"low","leverage":"medium"}'),

('43a12771-b982-43c7-ae5f-5671ebd5d212',
 'MTG /insights/[slug]: add BreadcrumbList JSON-LD',
 'MTG insights pages lack breadcrumb schema. Add BreadcrumbList to signal sitelinks eligibility.',
 'seo', 'manual', 'normal', 'open',
 'Edit mtgprices-web /src/app/insights/[slug]/page.tsx.',
 '{"source":"schema audit"}',
 '{"sprint":"CN-05B","batch":3,"task_num":14,"risk":"low","leverage":"low","repo":"pokepricesai/mtgprices-web"}'),

('f5267940-500b-4f1e-b17f-f49fbf605d3c',
 'OnePiece network-article path: BreadcrumbList JSON-LD',
 'Hardcoded articles emit it; the fallback network-article branch does not. Operator-published articles via CN-04 therefore miss breadcrumb schema.',
 'seo', 'manual', 'normal', 'open',
 'Edit apps/onepiece/src/app/insights/[slug]/page.tsx (network branch).',
 '{"source":"schema audit"}',
 '{"sprint":"CN-05B","batch":3,"task_num":15,"risk":"low","leverage":"low"}'),

('219e63bc-3526-47d9-aab4-057118dcd99c',
 'All sites: add aria-label="Breadcrumb" where missing',
 'A11y and semantic hint. Several existing breadcrumb <nav> blocks lack the attribute.',
 'seo', 'manual', 'normal', 'open',
 'Audit nav blocks across apps directories.',
 '{"source":"a11y audit"}',
 '{"sprint":"CN-05B","batch":3,"task_num":16,"risk":"low","leverage":"low"}'),

('43a12771-b982-43c7-ae5f-5671ebd5d212',
 'MTG homepage: WebSite + SearchAction + Breadcrumb JSON-LD',
 'Enables Google sitelinks search box. YGO + OP already have it; MTG does not.',
 'seo', 'manual', 'normal', 'open',
 'Edit mtgprices-web /src/app/page.tsx to inject JSON-LD.',
 '{"source":"schema audit"}',
 '{"sprint":"CN-05B","batch":3,"task_num":17,"risk":"low","leverage":"low","repo":"pokepricesai/mtgprices-web"}'),

('219e63bc-3526-47d9-aab4-057118dcd99c',
 'YGO /archetypes + /archetype/[slug]: link to related sets',
 '/archetypes gets 81 imp / 1 click; /archetype/[slug] gets 29 imp / 1 click. Topical interconnection to sets strengthens the graph.',
 'seo', 'manual', 'normal', 'open',
 'Edit apps/yugioh/src/app/archetype(s)/page.tsx.',
 '{"source":"GSC url_daily 12d","archetypes_imp":81,"archetype_imp":29}',
 '{"sprint":"CN-05B","batch":3,"task_num":18,"risk":"low","leverage":"medium"}'),

('f5267940-500b-4f1e-b17f-f49fbf605d3c',
 'OnePiece /leaders + /colours: cross-link to sets',
 '/leaders ranks pos 10-20 historically. Set-level crosslinks strengthen the topical graph.',
 'seo', 'manual', 'normal', 'open',
 'Edit apps/onepiece/src/app/leaders/page.tsx + colours/[slug]/page.tsx.',
 '{"source":"GSC url_daily 12d","colours_imp":20}',
 '{"sprint":"CN-05B","batch":3,"task_num":19,"risk":"low","leverage":"medium"}'),

('56d49be5-3c7c-462a-94cb-81b93bc173df',
 'Lorcana homepage: expand set + character grids to 24 each',
 'Pre-emptively mirror the YGO/OP/MTG homepage improvements for when Lorcana search visibility picks up.',
 'seo', 'manual', 'low', 'open',
 'Edit apps/lorcana/src/app/page.tsx.',
 '{"source":"schema audit"}',
 '{"sprint":"CN-05B","batch":3,"task_num":20,"risk":"low","leverage":"low","blocked_on":"lorcana vercel --prod"}')
;

select COUNT(*) AS cn05b_tasks
from public.network_tasks
where metadata->>'sprint' = 'CN-05B';
