# Cart quantity bug

The cart total ignores product quantities. Two notebooks at 9 each and three pens at 8 each should total **42**, but `cartTotal` returns **17**.

Run `node --test sample/cart.test.mjs` from the prepared demo workspace. The failing assertions are intentional starting conditions for this demo. Preserve them while fixing `sample/cart.mjs`.

Expected regression cases: empty cart → 0; one product priced 9 with quantity 2 → 18; both products → 42.
