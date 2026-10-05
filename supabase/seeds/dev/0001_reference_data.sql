-- =============================================================================
-- DEVELOPMENT SEED — reference data
-- Applied only by `supabase db reset` (local CLI) or `npm run db:seed:dev`.
-- Never run against production. Contains no orders, revenue or analytics.
-- =============================================================================

insert into public.categories (slug, name, description, position) values
  ('women',       'Women',       'Ready-to-wear, outerwear and accessories.', 1),
  ('men',         'Men',         'Tailoring, knitwear and essentials.', 2),
  ('accessories', 'Accessories', 'Bags, jewellery, eyewear and small leather goods.', 3),
  ('home',        'Home',        'Objects, textiles and fragrance for the home.', 4),
  ('beauty',      'Beauty',      'Skincare, fragrance and grooming.', 5)
on conflict (slug) do nothing;

insert into public.categories (parent_id, slug, name, position)
select c.id, v.slug, v.name, v.position
from (values
  ('women', 'women-outerwear', 'Outerwear', 1),
  ('women', 'women-dresses',   'Dresses', 2),
  ('women', 'women-knitwear',  'Knitwear', 3),
  ('men',   'men-tailoring',   'Tailoring', 1),
  ('men',   'men-knitwear',    'Knitwear', 2),
  ('accessories', 'bags',      'Bags', 1),
  ('accessories', 'jewellery', 'Jewellery', 2)
) as v(parent_slug, slug, name, position)
join public.categories c on c.slug = v.parent_slug
on conflict (slug) do nothing;

insert into public.subscription_plans (slug, name, description, currency, price_minor, billing_interval, commission_rate_bps, product_limit, features, position) values
  ('starter', 'Starter', 'For new labels testing the marketplace.', 'USD', 0,     'monthly', null, 50,   '["Up to 50 products","Standard commission","Monthly payouts"]', 1),
  ('studio',  'Studio',  'For growing brands with a full catalog.',  'USD', 4900,  'monthly', 1200, 500,  '["Up to 500 products","Reduced commission","Bi-weekly payouts","Storefront customisation"]', 2),
  ('maison',  'Maison',  'For established houses.',                  'USD', 19900, 'monthly', 900,  null, '["Unlimited products","Lowest commission","Weekly payouts","Featured placement credits"]', 3)
on conflict (slug) do nothing;
