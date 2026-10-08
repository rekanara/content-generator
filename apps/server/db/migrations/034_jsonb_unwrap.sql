-- 034: unwrap double-encoded jsonb. Writes used `${JSON.stringify(x)}::jsonb`, which
-- postgres.js sends as a jsonb STRING scalar ("{\"a\":1}"), not an object — so SQL like
-- llm_usage->>'totalCost' returned NULL (cost today / digest / budget all read 0).
-- Writers now use sql.json(); this fixes existing rows. Readers stay tolerant.
update posts set llm_usage = (llm_usage #>> '{}')::jsonb where jsonb_typeof(llm_usage) = 'string';
update overrides set images = (images #>> '{}')::jsonb where jsonb_typeof(images) = 'string';
update feeds_cache set items = (items #>> '{}')::jsonb where jsonb_typeof(items) = 'string';
update promotions set features = (features #>> '{}')::jsonb where jsonb_typeof(features) = 'string';
update promotions set stacks = (stacks #>> '{}')::jsonb where jsonb_typeof(stacks) = 'string';
update promotions set stats = (stats #>> '{}')::jsonb where jsonb_typeof(stats) = 'string';
update promotions set content = (content #>> '{}')::jsonb where jsonb_typeof(content) = 'string';
